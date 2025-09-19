const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// 🗄️ ARMAZENAMENTO EM MEMÓRIA COMPARTILHADO GLOBAL
if (!global.orders) global.orders = new Map();
if (!global.restaurantConversations) global.restaurantConversations = new Map();

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

        // 🔍 BUSCAR PEDIDO USANDO COMPARAÇÃO MAIS FLEXÍVEL
        const order = findOrderByRestaurantPhoneFlexible(phoneNumber);
        
        if (order) {
          console.log(`[WEBHOOK] 🍕 RESTAURANTE ENCONTRADO! Processando resposta...`);
          await handleRestaurantResponse(order, messageText, phoneNumber);
        } else {
          console.log(`[WEBHOOK] ❌ Nenhum pedido encontrado para telefone: ${phoneNumber}`);
          console.log(`[WEBHOOK] 📊 Pedidos ativos: ${global.orders.size}`);
          
          // Log de debug dos pedidos ativos
          for (const [sessionId, orderData] of global.orders) {
            const restPhone = orderData.restaurant?.whatsapp?.replace(/\D/g, '') || 'sem telefone';
            console.log(`[WEBHOOK] 🔍 Pedido ${sessionId}: ${restPhone}`);
          }
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

// 🔍 ENCONTRAR PEDIDO PELO TELEFONE DO RESTAURANTE - VERSÃO FLEXÍVEL
function findOrderByRestaurantPhoneFlexible(phone) {
  console.log(`[WEBHOOK] 🔍 Procurando pedido para telefone: ${phone}`);
  
  // Limpar formato do telefone para comparação (remover TUDO que não é número)
  const cleanPhone = phone.replace(/\D/g, '');
  console.log(`[WEBHOOK] 🧹 Telefone limpo: ${cleanPhone}`);
  
  for (const [sessionId, order] of global.orders) {
    if (order.restaurant && order.restaurant.whatsapp) {
      const cleanRestaurantPhone = order.restaurant.whatsapp.replace(/\D/g, '');
      
      console.log(`[WEBHOOK] 🔍 Comparando:`);
      console.log(`[WEBHOOK] 📱 Recebido: "${cleanPhone}" (${cleanPhone.length} dígitos)`);
      console.log(`[WEBHOOK] 🏪 Restaurante: "${cleanRestaurantPhone}" (${cleanRestaurantPhone.length} dígitos)`);
      
      // ✨ COMPARAÇÃO FLEXÍVEL - permitir diferentes formatos
      if (cleanRestaurantPhone === cleanPhone) {
        console.log(`[WEBHOOK] ✅ MATCH EXATO! Sessão: ${sessionId}`);
        return { ...order, sessionId };
      }
      
      // Se o número recebido tem menos dígitos, pode ser sem o código do país
      if (cleanPhone.length < cleanRestaurantPhone.length) {
        const restaurantWithoutCountryCode = cleanRestaurantPhone.substring(2); // Remove 55
        if (restaurantWithoutCountryCode === cleanPhone) {
          console.log(`[WEBHOOK] ✅ MATCH SEM CÓDIGO DO PAÍS! Sessão: ${sessionId}`);
          return { ...order, sessionId };
        }
      }
      
      // Se o número do restaurante tem menos dígitos
      if (cleanRestaurantPhone.length < cleanPhone.length) {
        const phoneWithoutCountryCode = cleanPhone.substring(2); // Remove 55
        if (cleanRestaurantPhone === phoneWithoutCountryCode) {
          console.log(`[WEBHOOK] ✅ MATCH REMOVENDO CÓDIGO DO RECEBIDO! Sessão: ${sessionId}`);
          return { ...order, sessionId };
        }
      }
      
      // Comparação por sufixo (últimos 9 dígitos - número do celular)
      if (cleanPhone.length >= 9 && cleanRestaurantPhone.length >= 9) {
        const phoneSuffix = cleanPhone.slice(-9);
        const restaurantSuffix = cleanRestaurantPhone.slice(-9);
        
        if (phoneSuffix === restaurantSuffix) {
          console.log(`[WEBHOOK] ✅ MATCH POR SUFIXO! Sessão: ${sessionId}`);
          return { ...order, sessionId };
        }
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
    let conversation = global.restaurantConversations.get(sessionId) || [];
    
    // Adicionar mensagem do restaurante à conversa
    conversation.push({
      role: 'restaurant',
      content: messageText,
      timestamp: new Date()
    });

    console.log(`[RESTAURANT] 📝 Conversa atualizada. Total: ${conversation.length} mensagens`);

    // 🔍 ANALISAR TIPO DE MENSAGEM DO RESTAURANTE
    const messageAnalysis = analyzeRestaurantMessage(messageText);
    console.log(`[RESTAURANT] 🔍 Análise: ${messageAnalysis.type}`);

    // 🎯 PROCESSAR BASEADO NO TIPO DA MENSAGEM
    if (messageAnalysis.needsClientInput) {
      console.log(`[RESTAURANT] ❓ Pergunta que precisa do cliente real`);
      
      await notifyClientForInput(sessionId, messageText, order.orderData);
      
      order.status = 'waiting_client_response';
      order.pendingQuestion = messageText;
      
    } else {
      console.log(`[RESTAURANT] 🤖 Gerando resposta automática como cliente`);
      
      // Gerar resposta automática usando Gemini
      const response = await generateClientResponse(conversation, order.orderData || {});
      
      if (response) {
        console.log(`[RESTAURANT] 💬 Resposta gerada: ${response.substring(0, 100)}...`);
        
        // Adicionar delay para parecer natural
        const delay = 2000 + Math.random() * 4000;
        console.log(`[RESTAURANT] ⏳ Aguardando ${Math.round(delay/1000)}s...`);
        
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

          // 🎉 VERIFICAR SE O PEDIDO FOI CONFIRMADO
          if (messageAnalysis.type === 'confirmed') {
            console.log(`[RESTAURANT] 🎉 PEDIDO CONFIRMADO!`);
            
            order.status = 'confirmed';
            await notifyClientOrderConfirmed(sessionId, messageText, order.orderData);
            await sendMultipleClientUpdates(sessionId, messageText, order.orderData);
            
          } else if (messageAnalysis.type === 'preparing') {
            console.log(`[RESTAURANT] 👨‍🍳 PEDIDO EM PREPARO!`);
            
            order.status = 'preparing';
            await notifyClientOrderStatus(sessionId, 'Seu pedido está sendo preparado! 👨‍🍳', order.orderData);
            
          } else if (messageAnalysis.type === 'out_for_delivery') {
            console.log(`[RESTAURANT] 🛵 SAIU PARA ENTREGA!`);
            
            order.status = 'out_for_delivery';
            await notifyClientOrderStatus(sessionId, 'Seu pedido saiu para entrega! 🛵', order.orderData);
          }
          
        } else {
          console.log(`[RESTAURANT] ❌ Erro ao enviar resposta`);
        }
      }
    }

    // Salvar conversa e pedido atualizados
    global.restaurantConversations.set(sessionId, conversation);
    global.orders.set(sessionId, order);

    console.log(`[RESTAURANT] 💾 Dados salvos para sessão: ${sessionId}`);

  } catch (error) {
    console.error('[RESTAURANT] ❌ Erro ao processar resposta:', error);
  }
}

// 🔍 ANALISAR MENSAGEM DO RESTAURANTE
function analyzeRestaurantMessage(message) {
  const messageLower = message.toLowerCase();
  
  const clientInputKeywords = [
    'forma de pagamento', 'precisa de troco', 'quanto de troco', 'cartão ou dinheiro',
    'pix ou dinheiro', 'observações', 'sem cebola', 'sem tomate', 'ponto da carne',
    'bebida gelada', 'refrigerante', 'qual sabor', 'qual tamanho', 'confirma o endereço',
    'qual o complemento', 'apartamento', 'bloco', 'referência', 'você prefere',
    'gostaria de', 'quer adicionar', 'alguma observação', 'alguma preferência'
  ];

  const confirmationKeywords = [
    'pedido confirmado', 'vamos preparar', 'já estamos preparando', 'tempo de entrega',
    'chega em', 'fica pronto em', 'ok, anotado', 'perfeito', 'confirmado',
    'anotei', 'valor total', 'total fica', 'vai ficar'
  ];

  const preparingKeywords = [
    'preparando', 'na cozinha', 'fazendo', 'no forno', 'assando', 'montando'
  ];

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
Nome: ${orderData.clientName || 'Cliente'}
Endereço: ${orderData.address || 'Informado'}
Telefone: ${orderData.phone || 'Informado'}  
Pagamento: ${orderData.paymentMethod || 'Informado'}
${orderData.change ? `Troco para: R$ ${orderData.change}` : ''}
`;

    const conversationHistory = conversation.map(msg => {
      const role = msg.role === 'restaurant' ? 'Restaurante' : 'Eu';
      return `${role}: ${msg.content}`;
    }).slice(-6).join('\n');

    const prompt = CLIENT_RESPONSE_PROMPT
      .replace('{ORDER_CONTEXT}', orderContext)
      .replace('{CONVERSATION_HISTORY}', conversationHistory);

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();

    let finalResponse = response;
    if (finalResponse.length > 200) {
      finalResponse = finalResponse.substring(0, 200).trim();
      const lastSpace = finalResponse.lastIndexOf(' ');
      if (lastSpace > 160) {
        finalResponse = finalResponse.substring(0, lastSpace);
      }
    }

    console.log(`[CLIENT_AI] ✅ Resposta gerada: ${finalResponse}`);
    return finalResponse;

  } catch (error) {
    console.error('[CLIENT_AI] ❌ Erro ao gerar resposta:', error);
    
    // Fallbacks baseados na mensagem do restaurante
    const lastMessage = conversation[conversation.length - 1]?.content || '';
    
    if (lastMessage.toLowerCase().includes('confirmado')) {
      return 'Perfeito! Obrigado! Quanto tempo vai demorar? 😊';
    } else if (lastMessage.toLowerCase().includes('tempo')) {
      return 'Ok, perfeito! Obrigado! 👍';
    } else if (lastMessage.toLowerCase().includes('valor')) {
      return 'Está certo! Pode fazer. Obrigado! 🙏';
    } else {
      return 'Entendi! Obrigado pela informação. 😊';
    }
  }
}

// 📢 NOTIFICAR CLIENTE - USANDO NÚMERO DO CLIENTE
async function notifyClientForInput(sessionId, question, orderData) {
  console.log(`[NOTIFY] 📢 Notificar cliente ${sessionId}: ${question}`);
  
  if (orderData && orderData.phone) {
    console.log(`[NOTIFY] 📱 Enviando para cliente: ${orderData.phone}`);
    
    const clientMessage = `🍕 IA Fome: O restaurante perguntou:

"${question}"

Por favor, responda no chat do IA Fome: https://iafome.netlify.app

Preciso da sua resposta para continuar o pedido! 🙏`;
    
    await sendWhatsAppMessage(orderData.phone, clientMessage);
    console.log(`[NOTIFY] 📱 Notificação enviada para cliente`);
  } else {
    console.log(`[NOTIFY] ⚠️ Dados do cliente não encontrados`);
  }
}

// 🎉 NOTIFICAR CLIENTE QUE PEDIDO FOI CONFIRMADO
async function notifyClientOrderConfirmed(sessionId, restaurantMessage, orderData) {
  console.log(`[NOTIFY] 🎉 Pedido confirmado para cliente ${sessionId}`);
  
  if (orderData && orderData.phone) {
    const clientName = orderData.clientName || 'Cliente';
    
    const clientMessage = `🎉 ${clientName}! SEU PEDIDO FOI CONFIRMADO!

${restaurantMessage}

Pode ficar tranquilo(a) que está tudo certo! Vou te avisar por WhatsApp quando houver novidades! 😊

Acompanhe: https://iafome.netlify.app`;
    
    await sendWhatsAppMessage(orderData.phone, clientMessage);
    console.log(`[NOTIFY] 🎉 Confirmação enviada para cliente`);
  }
}

// 📱 ENVIAR MÚLTIPLAS MENSAGENS SEQUENCIAIS
async function sendMultipleClientUpdates(sessionId, restaurantMessage, orderData) {
  console.log(`[NOTIFY] 📱 Enviando atualizações sequenciais`);
  
  if (orderData && orderData.phone) {
    const clientPhone = orderData.phone;
    const clientName = orderData.clientName || 'Cliente';
    
    // Mensagem 1
    await sendWhatsAppMessage(clientPhone, `🎉 Perfeito, ${clientName}! Seu pedido foi confirmado pelo restaurante!`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Mensagem 2
    await sendWhatsAppMessage(clientPhone, '👨‍🍳 Eles já começaram a preparar sua comida! Tudo certo!');
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Mensagem 3
    await sendWhatsAppMessage(clientPhone, '📱 Pode fechar o IA Fome tranquilo! Vou te avisar aqui no WhatsApp quando sair para entrega! 😊');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mensagem 4
    await sendWhatsAppMessage(clientPhone, '⏰ Seu pedido deve chegar em cerca de 40-50 minutos. Relaxa que está tudo sob controle! 🍕✨');
    
    console.log(`[NOTIFY] 🎉 Todas as mensagens enviadas!`);
  }
}

// 📊 NOTIFICAR CLIENTE SOBRE STATUS
async function notifyClientOrderStatus(sessionId, statusMessage, orderData) {
  console.log(`[NOTIFY] 📊 Status para cliente ${sessionId}: ${statusMessage}`);
  
  if (orderData && orderData.phone) {
    const fullMessage = `🍕 IA Fome: ${statusMessage}

Qualquer novidade eu te aviso! 😊`;
    
    await sendWhatsAppMessage(orderData.phone, fullMessage);
    console.log(`[NOTIFY] 📊 Status enviado para cliente`);
  }
}

// 📱 ENVIAR MENSAGEM VIA EVOLUTION API
async function sendWhatsAppMessage(phone, message) {
  try {
    console.log(`[WHATSAPP] 📱 Enviando para: ${phone}`);
    
    if (!EVOLUTION_BASE_URL || !EVOLUTION_TOKEN || !EVOLUTION_INSTANCE_ID) {
      console.error(`[WHATSAPP] ❌ Configurações faltando!`);
      return false;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const url = `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ID}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message
      })
    });

    if (response.ok) {
      console.log(`[WHATSAPP] ✅ Mensagem enviada!`);
      return true;
    } else {
      console.error(`[WHATSAPP] ❌ Erro ${response.status}`);
      return false;
    }
    
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Erro crítico:`, error);
    return false;
  }
}
