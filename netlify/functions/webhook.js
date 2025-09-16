const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// 🗄️ ARMAZENAMENTO EM MEMÓRIA COMPARTILHADO (usar base de dados real em produção)
const sessions = new Map();
const orders = new Map();
const restaurantConversations = new Map();

// 🎭 PROMPT PARA RESPONDER COMO CLIENTE HUMANO
const CLIENT_RESPONSE_PROMPT = `
Você é um cliente real fazendo um pedido de delivery por WhatsApp. Responda às perguntas do restaurante de forma natural, educada e humana.

PERSONALIDADE:
- Cliente brasileiro comum
- Educado mas direto
- Ansioso pelo pedido
- Fala de forma natural (sem ser muito formal)

REGRAS DE RESPOSTA:
- Use linguagem coloquial brasileira
- Seja educado: "obrigado", "por favor", "oi", "tudo bem?"
- Responda apenas o que foi perguntado
- Se não souber algo específico, peça um momento para verificar
- Demonstre que está interessado no pedido
- Use emojis ocasionalmente (😊, 👍, 🙏)

INFORMAÇÕES DO SEU PEDIDO:
{ORDER_CONTEXT}

CONVERSA ATÉ AGORA:
{CONVERSATION_HISTORY}

IMPORTANTE: 
- Responda como se fosse o cliente real
- NÃO mencione que é uma IA
- Seja consistente com as informações do pedido
- Se o restaurante confirmar o pedido, agradeça e pergunte o tempo de entrega

Responda de forma humana e natural:
`;

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const webhookData = JSON.parse(event.body);
    console.log(`[WEBHOOK] 📥 Dados recebidos:`, JSON.stringify(webhookData, null, 2));
    
    // Verificar se é uma mensagem recebida
    if (webhookData.event === 'messages.upsert' && webhookData.data) {
      const message = webhookData.data;
      
      // Verificar se é uma mensagem recebida (não enviada por nós)
      if (message.key && !message.key.fromMe && message.message) {
        const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '');
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        console.log(`[WEBHOOK] 📱 Mensagem recebida de ${phoneNumber}: ${messageText}`);

        // Verificar se é resposta de um restaurante
        const order = findOrderByRestaurantPhone(phoneNumber);
        
        if (order) {
          console.log(`[WEBHOOK] 🍕 Mensagem é de restaurante! Processando...`);
          await handleRestaurantResponse(order, messageText, phoneNumber);
        } else {
          console.log(`[WEBHOOK] ⏭️ Mensagem não é de restaurante conhecido`);
        }
      } else {
        console.log(`[WEBHOOK] ⏭️ Mensagem enviada por nós, ignorando`);
      }
    } else {
      console.log(`[WEBHOOK] ⏭️ Evento não é mensagem, ignorando`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('[WEBHOOK] ❌ Erro crítico:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// 🔍 ENCONTRAR PEDIDO PELO TELEFONE DO RESTAURANTE
function findOrderByRestaurantPhone(phone) {
  console.log(`[WEBHOOK] 🔍 Procurando pedido para telefone: ${phone}`);
  
  // Limpar formato do telefone para comparação
  const cleanPhone = phone.replace(/\D/g, '');
  
  for (const [sessionId, order] of orders) {
    if (order.restaurant && order.restaurant.whatsapp) {
      const cleanRestaurantPhone = order.restaurant.whatsapp.replace(/\D/g, '');
      console.log(`[WEBHOOK] 🔍 Comparando ${cleanPhone} com ${cleanRestaurantPhone}`);
      
      if (cleanRestaurantPhone === cleanPhone) {
        console.log(`[WEBHOOK] ✅ Pedido encontrado para sessão: ${sessionId}`);
        return { ...order, sessionId };
      }
    }
  }
  
  console.log(`[WEBHOOK] ❌ Nenhum pedido encontrado para o telefone: ${phone}`);
  return null;
}

// 🎭 PROCESSAR RESPOSTA DO RESTAURANTE
async function handleRestaurantResponse(order, messageText, restaurantPhone) {
  try {
    console.log(`[RESTAURANT] 🍕 Processando resposta do restaurante`);
    console.log(`[RESTAURANT] 📱 Telefone: ${restaurantPhone}`);
    console.log(`[RESTAURANT] 💬 Mensagem: ${messageText}`);

    const sessionId = order.sessionId;
    
    // Obter conversa existente com o restaurante
    let conversation = restaurantConversations.get(sessionId) || [];
    
    // Adicionar mensagem do restaurante à conversa
    conversation.push({
      role: 'restaurant',
      content: messageText,
      timestamp: new Date()
    });

    console.log(`[RESTAURANT] 📝 Conversa atualizada. Total de mensagens: ${conversation.length}`);

    // 🔍 ANALISAR TIPO DE MENSAGEM DO RESTAURANTE
    const messageAnalysis = analyzeRestaurantMessage(messageText);
    console.log(`[RESTAURANT] 🔍 Análise: ${messageAnalysis.type}`);

    // 🎯 PROCESSAR BASEADO NO TIPO DA MENSAGEM
    if (messageAnalysis.needsClientInput) {
      console.log(`[RESTAURANT] ❓ Pergunta que precisa do cliente real`);
      
      // Enviar pergunta para o cliente no IA Fome
      await notifyClientForInput(sessionId, messageText);
      
      // Marcar que estamos esperando resposta do cliente
      order.status = 'waiting_client_response';
      order.pendingQuestion = messageText;
      
    } else {
      console.log(`[RESTAURANT] 🤖 Gerando resposta automática como cliente`);
      
      // Gerar resposta automática usando Gemini
      const response = await generateClientResponse(conversation, order.orderData || {});
      
      if (response) {
        console.log(`[RESTAURANT] 💬 Resposta gerada: ${response.substring(0, 100)}...`);
        
        // Adicionar delay para parecer natural
        const delay = 2000 + Math.random() * 4000; // 2-6 segundos
        console.log(`[RESTAURANT] ⏳ Aguardando ${Math.round(delay/1000)}s antes de responder`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Enviar resposta para o restaurante
        const sent = await sendWhatsAppMessage(restaurantPhone, response);
        
        if (sent) {
          console.log(`[RESTAURANT] ✅ Resposta enviada com sucesso`);
          
          // Adicionar nossa resposta à conversa
          conversation.push({
            role: 'client',
            content: response,
            timestamp: new Date()
          });

          // 🎉 VERIFICAR SE O PEDIDO FOI CONFIRMADO/STATUS MUDOU
          if (messageAnalysis.type === 'confirmed') {
            console.log(`[RESTAURANT] 🎉 PEDIDO CONFIRMADO!`);
            
            order.status = 'confirmed';
            await notifyClientOrderConfirmed(sessionId, messageText);
            
            // Enviar múltiplas mensagens sequenciais para tranquilizar o cliente
            await sendMultipleClientUpdates(sessionId, messageText);
            
          } else if (messageAnalysis.type === 'preparing') {
            console.log(`[RESTAURANT] 👨‍🍳 PEDIDO EM PREPARO!`);
            
            order.status = 'preparing';
            await notifyClientOrderStatus(sessionId, 'Seu pedido está sendo preparado! 👨‍🍳');
            
          } else if (messageAnalysis.type === 'out_for_delivery') {
            console.log(`[RESTAURANT] 🛵 SAIU PARA ENTREGA!`);
            
            order.status = 'out_for_delivery';
            await notifyClientOrderStatus(sessionId, 'Seu pedido saiu para entrega! 🛵 Em breve estará aí!');
            
          }
          
        } else {
          console.log(`[RESTAURANT] ❌ Erro ao enviar resposta`);
        }
      } else {
        console.log(`[RESTAURANT] ❌ Erro ao gerar resposta`);
      }
    }

    // Salvar conversa e pedido atualizados
    restaurantConversations.set(sessionId, conversation);
    orders.set(sessionId, order);

    console.log(`[RESTAURANT] 💾 Dados salvos para sessão: ${sessionId}`);

  } catch (error) {
    console.error('[RESTAURANT] ❌ Erro ao processar resposta:', error);
  }
}

// 🔍 ANALISAR MENSAGEM DO RESTAURANTE
function analyzeRestaurantMessage(message) {
  const messageLower = message.toLowerCase();
  
  // Palavras-chave que indicam que precisa de input do cliente
  const clientInputKeywords = [
    'forma de pagamento', 'precisa de troco', 'quanto de troco', 'cartão ou dinheiro',
    'pix ou dinheiro', 'observações', 'sem cebola', 'sem tomate', 'ponto da carne',
    'bebida gelada', 'refrigerante', 'qual sabor', 'qual tamanho', 'confirma o endereço',
    'qual o complemento', 'apartamento', 'bloco', 'referência', 'você prefere',
    'gostaria de', 'quer adicionar', 'alguma observação', 'alguma preferência'
  ];

  // Palavras-chave que indicam confirmação do pedido
  const confirmationKeywords = [
    'pedido confirmado', 'vamos preparar', 'já estamos preparando', 'tempo de entrega',
    'chega em', 'fica pronto em', 'ok, anotado', 'perfeito', 'confirmado',
    'anotei', 'valor total', 'total fica', 'vai ficar'
  ];

  // Palavras-chave que indicam preparo
  const preparingKeywords = [
    'preparando', 'na cozinha', 'fazendo', 'no forno', 'assando', 'montando'
  ];

  // Palavras-chave que indicam saída para entrega
  const deliveryKeywords = [
    'saiu para entrega', 'a caminho', 'entregador saiu', 'motoboy saiu', 
    'delivery a caminho', 'saindo', 'chegando'
  ];

  const needsClientInput = clientInputKeywords.some(keyword => 
    messageLower.includes(keyword)
  );

  let type = 'general';
  if (confirmationKeywords.some(k => messageLower.includes(k))) type = 'confirmed';
  else if (preparingKeywords.some(k => messageLower.includes(k))) type = 'preparing';
  else if (deliveryKeywords.some(k => messageLower.includes(k))) type = 'out_for_delivery';

  return {
    type,
    needsClientInput,
    isQuestion: messageLower.includes('?'),
    isGreeting: messageLower.includes('oi') || messageLower.includes('olá')
  };
}

// 🤖 GERAR RESPOSTA AUTOMÁTICA COMO CLIENTE
async function generateClientResponse(conversation, orderData) {
  try {
    console.log(`[CLIENT_AI] 🤖 Gerando resposta como cliente`);
    
    const orderContext = `
Comida pedida: ${orderData.food || 'Pizza'}
Endereço: ${orderData.address || 'Informado'}
Telefone: ${orderData.phone || 'Informado'}  
Pagamento: ${orderData.paymentMethod || 'Informado'}
${orderData.change ? `Troco para: R$ ${orderData.change}` : ''}
`;

    const conversationHistory = conversation.map(msg => {
      const role = msg.role === 'restaurant' ? 'Restaurante' : 'Eu';
      return `${role}: ${msg.content}`;
    }).slice(-6).join('\n'); // Últimas 6 mensagens para contexto

    const prompt = CLIENT_RESPONSE_PROMPT
      .replace('{ORDER_CONTEXT}', orderContext)
      .replace('{CONVERSATION_HISTORY}', conversationHistory);

    console.log(`[CLIENT_AI] 📝 Gerando com Gemini...`);

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();

    // Limitar tamanho da resposta para parecer mais humano
    const maxLength = 200;
    let finalResponse = response;
    
    if (finalResponse.length > maxLength) {
      finalResponse = finalResponse.substring(0, maxLength).trim();
      // Garantir que termine com palavra completa
      const lastSpace = finalResponse.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.8) {
        finalResponse = finalResponse.substring(0, lastSpace);
      }
    }

    console.log(`[CLIENT_AI] ✅ Resposta gerada: ${finalResponse}`);
    return finalResponse;

  } catch (error) {
    console.error('[CLIENT_AI] ❌ Erro ao gerar resposta:', error);
    
    // Fallbacks baseados na última mensagem do restaurante
    const lastMessage = conversation[conversation.length - 1]?.content || '';
    
    if (lastMessage.toLowerCase().includes('confirmado') || lastMessage.toLowerCase().includes('anotado')) {
      return 'Perfeito! Obrigado! Quanto tempo vai demorar mais ou menos? 😊';
    } else if (lastMessage.toLowerCase().includes('tempo') || lastMessage.toLowerCase().includes('minutos')) {
      return 'Ok, perfeito! Obrigado! 👍';
    } else if (lastMessage.toLowerCase().includes('valor') || lastMessage.toLowerCase().includes('total')) {
      return 'Está certo! Pode fazer. Obrigado! 🙏';
    } else {
      return 'Entendi! Obrigado pela informação. 😊';
    }
  }
}

// 📢 NOTIFICAR CLIENTE PARA INPUT
async function notifyClientForInput(sessionId, question) {
  console.log(`[NOTIFY] 📢 Notificar cliente ${sessionId}: ${question}`);
  
  // Buscar informações da sessão (se necessário, implementar busca na base de dados)
  const session = sessions.get(sessionId);
  if (session && session.orderData && session.orderData.phone) {
    const clientMessage = `🍕 IA Fome: O restaurante perguntou:

"${question}"

Por favor, responda no chat do IA Fome: https://iafome.netlify.app

Preciso da sua resposta para continuar o pedido! 🙏`;
    
    await sendWhatsAppMessage(session.orderData.phone, clientMessage);
    console.log(`[NOTIFY] 📱 Notificação enviada para cliente via WhatsApp`);
  } else {
    console.log(`[NOTIFY] ⚠️ Dados do cliente não encontrados para sessão: ${sessionId}`);
  }
}

// 🎉 NOTIFICAR CLIENTE QUE PEDIDO FOI CONFIRMADO
async function notifyClientOrderConfirmed(sessionId, restaurantMessage) {
  console.log(`[NOTIFY] 🎉 Pedido confirmado para cliente ${sessionId}`);
  
  const session = sessions.get(sessionId);
  if (session && session.orderData && session.orderData.phone) {
    const clientMessage = `🎉 IA Fome: SEU PEDIDO FOI CONFIRMADO!

${restaurantMessage}

Relaxa que está tudo certo! Em breve sua comida chegará! 😊

Acompanhe pelo chat: https://iafome.netlify.app`;
    
    await sendWhatsAppMessage(session.orderData.phone, clientMessage);
    console.log(`[NOTIFY] 🎉 Confirmação enviada para cliente via WhatsApp`);
  }
}

// 📱 ENVIAR MÚLTIPLAS MENSAGENS SEQUENCIAIS PARA TRANQUILIZAR
async function sendMultipleClientUpdates(sessionId, restaurantMessage) {
  console.log(`[NOTIFY] 📱 Enviando atualizações sequenciais para cliente ${sessionId}`);
  
  const session = sessions.get(sessionId);
  if (session && session.orderData && session.orderData.phone) {
    const clientPhone = session.orderData.phone;
    
    // Primeira mensagem
    await sendWhatsAppMessage(clientPhone, '🎉 Perfeito! Seu pedido foi confirmado pelo restaurante!');
    console.log(`[NOTIFY] ✅ Mensagem 1/4 enviada`);
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Segunda mensagem
    await sendWhatsAppMessage(clientPhone, '👨‍🍳 Eles já começaram a preparar sua comida! Tudo certo!');
    console.log(`[NOTIFY] ✅ Mensagem 2/4 enviada`);
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Terceira mensagem
    await sendWhatsAppMessage(clientPhone, '📱 Pode fechar o IA Fome tranquilo! Vou te avisar aqui no WhatsApp quando sair para entrega! 😊');
    console.log(`[NOTIFY] ✅ Mensagem 3/4 enviada`);
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Quarta mensagem
    await sendWhatsAppMessage(clientPhone, '⏰ Seu pedido deve chegar em cerca de 40-50 minutos. Relaxa que está tudo sob controle! 🍕✨');
    console.log(`[NOTIFY] ✅ Mensagem 4/4 enviada`);
    
    console.log(`[NOTIFY] 🎉 Todas as mensagens de tranquilização enviadas!`);
  }
}

// 📊 NOTIFICAR CLIENTE SOBRE STATUS DO PEDIDO
async function notifyClientOrderStatus(sessionId, statusMessage) {
  console.log(`[NOTIFY] 📊 Status para cliente ${sessionId}: ${statusMessage}`);
  
  const session = sessions.get(sessionId);
  if (session && session.orderData && session.orderData.phone) {
    const fullMessage = `🍕 IA Fome: ${statusMessage}

Qualquer novidade eu te aviso! 😊`;
    
    await sendWhatsAppMessage(session.orderData.phone, fullMessage);
    console.log(`[NOTIFY] 📊 Status enviado para cliente via WhatsApp`);
  }
}

// 📱 ENVIAR MENSAGEM VIA EVOLUTION API (MESMO MÉTODO DO CHAT.JS)
async function sendWhatsAppMessage(phone, message) {
  try {
    console.log(`[WHATSAPP] 📱 Enviando para: ${phone}`);
    console.log(`[WHATSAPP] 💬 Mensagem: ${message.substring(0, 100)}...`);
    
    if (!EVOLUTION_BASE_URL || !EVOLUTION_TOKEN || !EVOLUTION_INSTANCE_ID) {
      console.error(`[WHATSAPP] ❌ VARIÁVEIS DE AMBIENTE FALTANDO!`);
      return false;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const url = `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ID}`;
    
    console.log(`[WHATSAPP] 🌐 URL: ${url}`);
    console.log(`[WHATSAPP] 📞 Telefone limpo: ${cleanPhone}`);

    const payload = {
      number: cleanPhone,
      text: message
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
      },
      body: JSON.stringify(payload)
    });

    console.log(`[WHATSAPP] 📊 Status: ${response.status}`);

    if (response.ok) {
      const result = await response.text();
      console.log(`[WHATSAPP] ✅ SUCESSO! Resposta: ${result.substring(0, 100)}...`);
      return true;
    } else {
      const error = await response.text();
      console.error(`[WHATSAPP] ❌ ERRO ${response.status}: ${error}`);
      return false;
    }
    
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Erro crítico:`, error);
    return false;
  }
}
