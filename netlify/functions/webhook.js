const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória (mesmo que o chat.js)
const sessions = new Map();
const orders = new Map();
const restaurantConversations = new Map();

// Prompt para responder como cliente
const CLIENT_RESPONSE_PROMPT = `
Você é um cliente fazendo um pedido de delivery. Responda às perguntas do restaurante de forma natural e educada.
Seja direto e forneça as informações solicitadas.
Mantenha um tom amigável mas objetivo.
Se for uma pergunta que você não sabe responder (como preferências específicas), diga que vai verificar e responder em breve.

CONTEXTO DO PEDIDO:
{ORDER_CONTEXT}

HISTÓRICO DA CONVERSA:
{CONVERSATION_HISTORY}

Responda de forma humana e natural, como se fosse um cliente real.
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
    
    // Verificar se é uma mensagem recebida
    if (webhookData.event === 'messages.upsert' && webhookData.data) {
      const message = webhookData.data;
      
      // Verificar se é uma mensagem recebida (não enviada por nós)
      if (message.key && !message.key.fromMe && message.message) {
        const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '');
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';

        console.log(`Mensagem recebida de ${phoneNumber}: ${messageText}`);

        // Verificar se é resposta de um restaurante
        const order = findOrderByRestaurantPhone(phoneNumber);
        
        if (order) {
          await handleRestaurantResponse(order, messageText, phoneNumber);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Erro no webhook:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Encontrar pedido pelo telefone do restaurante
function findOrderByRestaurantPhone(phone) {
  for (const [sessionId, order] of orders) {
    if (order.restaurant && order.restaurant.phone === phone) {
      return order;
    }
  }
  return null;
}

// Processar resposta do restaurante
async function handleRestaurantResponse(order, messageText, restaurantPhone) {
  try {
    // Obter conversa existente com o restaurante
    let conversation = restaurantConversations.get(order.sessionId) || [];
    
    // Adicionar mensagem do restaurante à conversa
    conversation.push({
      role: 'restaurant',
      content: messageText,
      timestamp: new Date()
    });

    // Analisar se é uma pergunta que precisa do cliente real
    const needsClientInput = analyzeIfNeedsClientInput(messageText);

    if (needsClientInput) {
      // Enviar pergunta para o cliente no IA Fome e WhatsApp
      await notifyClientForInput(order.sessionId, messageText);
      
      // Marcar que estamos esperando resposta do cliente
      order.status = 'waiting_client_response';
      order.pendingQuestion = messageText;
      
    } else {
      // Gerar resposta automática usando Gemini
      const response = await generateClientResponse(conversation, order.orderData);
      
      // Adicionar delay para parecer natural
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
      
      // Enviar resposta para o restaurante
      await sendWhatsAppMessage(restaurantPhone, response);
      
      // Adicionar nossa resposta à conversa
      conversation.push({
        role: 'client',
        content: response,
        timestamp: new Date()
      });

      // Verificar se o pedido foi confirmado
      if (isOrderConfirmed(messageText)) {
        order.status = 'confirmed';
        await notifyClientOrderConfirmed(order.sessionId, messageText);
        
        // Enviar múltiplas mensagens sequenciais para tranquilizar o cliente
        await sendMultipleClientUpdates(order.sessionId, messageText);
      }

      // Verificar se está preparando
      if (isOrderPreparing(messageText)) {
        order.status = 'preparing';
        await notifyClientOrderStatus(order.sessionId, 'Seu pedido está sendo preparado! 👨‍🍳');
      }

      // Verificar se saiu para entrega
      if (isOrderOutForDelivery(messageText)) {
        order.status = 'out_for_delivery';
        await notifyClientOrderStatus(order.sessionId, 'Seu pedido saiu para entrega! 🛵');
      }
    }

    // Salvar conversa atualizada
    restaurantConversations.set(order.sessionId, conversation);
    orders.set(order.sessionId, order);

  } catch (error) {
    console.error('Erro ao processar resposta do restaurante:', error);
  }
}

// Analisar se a mensagem do restaurante precisa de input do cliente
function analyzeIfNeedsClientInput(message) {
  const clientInputKeywords = [
    'forma de pagamento',
    'precisa de troco',
    'quanto de troco',
    'cartão ou dinheiro',
    'pix ou dinheiro',
    'observações',
    'sem cebola',
    'sem tomate',
    'ponto da carne',
    'bebida gelada',
    'refrigerante',
    'qual sabor',
    'qual tamanho',
    'confirma o endereço',
    'qual o complemento',
    'apartamento',
    'bloco',
    'referência',
    'você prefere',
    'gostaria de',
    'quer adicionar'
  ];

  return clientInputKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
}

// Gerar resposta automática como cliente
async function generateClientResponse(conversation, orderData) {
  try {
    const orderContext = `
    - Comida: ${orderData.food}
    - Endereço: ${orderData.address}
    - Telefone: ${orderData.phone}
    - Pagamento: ${orderData.paymentMethod}
    ${orderData.change ? `- Troco para: R$ ${orderData.change}` : ''}
    `;

    const conversationHistory = conversation.map(msg => {
      const role = msg.role === 'restaurant' ? 'Restaurante' : 'Eu';
      return `${role}: ${msg.content}`;
    }).join('\n');

    const prompt = CLIENT_RESPONSE_PROMPT
      .replace('{ORDER_CONTEXT}', orderContext)
      .replace('{CONVERSATION_HISTORY}', conversationHistory);

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text().trim();

  } catch (error) {
    console.error('Erro ao gerar resposta do cliente:', error);
    return 'Obrigado! Aguardo mais informações.';
  }
}

// Notificar cliente para input
async function notifyClientForInput(sessionId, question) {
  // Aqui você implementaria a notificação no chat do IA Fome
  // Por enquanto, apenas log
  console.log(`Notificar cliente ${sessionId}: ${question}`);
  
  // Também enviar WhatsApp para o cliente se tivermos o número
  const session = sessions.get(sessionId);
  if (session && session.orderData.phone) {
    const clientMessage = `🍕 IA Fome: O restaurante perguntou: "${question}"\n\nPor favor, responda no chat do IA Fome: https://iafome.netlify.app`;
    await sendWhatsAppMessage(session.orderData.phone, clientMessage);
  }
}

// Notificar cliente que pedido foi confirmado
async function notifyClientOrderConfirmed(sessionId, restaurantMessage) {
  console.log(`Pedido confirmado para cliente ${sessionId}: ${restaurantMessage}`);
  
  const session = sessions.get(sessionId);
  if (session && session.orderData.phone) {
    const clientMessage = `🍕 IA Fome: Seu pedido foi confirmado! 🎉\n\n${restaurantMessage}\n\nAcompanhe pelo chat: https://iafome.netlify.app`;
    await sendWhatsAppMessage(session.orderData.phone, clientMessage);
  }
}

// Enviar múltiplas mensagens sequenciais para tranquilizar o cliente
async function sendMultipleClientUpdates(sessionId, restaurantMessage) {
  const session = sessions.get(sessionId);
  if (session && session.orderData.phone) {
    // Primeira mensagem
    await sendWhatsAppMessage(session.orderData.phone, '🎉 Perfeito! Seu pedido foi confirmado pelo restaurante!');
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Segunda mensagem
    await sendWhatsAppMessage(session.orderData.phone, '👨‍🍳 Eles já começaram a preparar sua comida!');
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Terceira mensagem
    await sendWhatsAppMessage(session.orderData.phone, '📱 Você pode sair do IA Fome tranquilo, vou te avisar aqui no WhatsApp quando sair para entrega!');
    
    // Delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Quarta mensagem
    await sendWhatsAppMessage(session.orderData.phone, '⏰ Tempo estimado: 40-50 minutos. Relaxa que está tudo certo! 😊');
  }
}

// Notificar cliente sobre status do pedido
async function notifyClientOrderStatus(sessionId, statusMessage) {
  console.log(`Status do pedido para cliente ${sessionId}: ${statusMessage}`);
  
  const session = sessions.get(sessionId);
  if (session && session.orderData.phone) {
    await sendWhatsAppMessage(session.orderData.phone, `🍕 IA Fome: ${statusMessage}`);
  }
}

// Verificar se pedido foi confirmado
function isOrderConfirmed(message) {
  const confirmationKeywords = [
    'pedido confirmado',
    'vamos preparar',
    'já estamos preparando',
    'tempo de entrega',
    'chega em',
    'fica pronto em',
    'ok, anotado',
    'perfeito',
    'confirmado'
  ];

  return confirmationKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
}

// Verificar se está preparando
function isOrderPreparing(message) {
  const preparingKeywords = [
    'preparando',
    'na cozinha',
    'fazendo',
    'no forno',
    'assando'
  ];

  return preparingKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
}

// Verificar se saiu para entrega
function isOrderOutForDelivery(message) {
  const deliveryKeywords = [
    'saiu para entrega',
    'a caminho',
    'entregador saiu',
    'motoboy saiu',
    'delivery a caminho'
  ];

  return deliveryKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
}

// Função para enviar mensagem via Evolution API
async function sendWhatsAppMessage(phone, message) {
  try {
    // Adicionar delay para parecer mais natural
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    const response = await fetch(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
      },
      body: JSON.stringify({
        number: phone,
        text: message
      })
    });

    if (!response.ok) {
      throw new Error(`Erro ao enviar mensagem: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Erro ao enviar WhatsApp:', error);
    throw error;
  }
}
