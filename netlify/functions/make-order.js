const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    const { sessionId, restaurant, orderData } = JSON.parse(event.body);

    if (!sessionId || !restaurant || !orderData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Dados obrigatórios faltando' })
      };
    }

    console.log(`[ORDER] Fazendo pedido para: ${restaurant.name}`);
    console.log(`[ORDER] Dados:`, orderData);

    // Criar mensagem humanizada para o restaurante
    const orderPrompt = `
Crie uma mensagem de pedido para um restaurante via WhatsApp. A mensagem deve ser:
- Natural e educada
- Como se fosse um cliente real fazendo pedido
- Com todas as informações necessárias
- Formatada de forma clara

DADOS DO PEDIDO:
- Comida: ${orderData.food}
- Endereço: ${orderData.address}
- Telefone: ${orderData.phone}
- Pagamento: ${orderData.paymentMethod}
${orderData.change ? `- Troco para: R$ ${orderData.change}` : ''}

RESTAURANTE: ${restaurant.name}

Crie uma mensagem natural e profissional.
`;

    // Gerar mensagem com IA
    const result = await model.generateContent(orderPrompt);
    const orderMessage = result.response.text().trim();

    console.log(`[ORDER] Mensagem gerada: ${orderMessage}`);

    // Enviar mensagem para o restaurante
    const whatsappSuccess = await sendWhatsAppMessage(restaurant.phone, orderMessage);
    
    if (whatsappSuccess) {
      console.log(`[ORDER] Pedido enviado com sucesso para ${restaurant.name}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Pedido enviado para ${restaurant.name}!`,
          restaurant: restaurant.name,
          estimatedTime: restaurant.estimatedTime
        })
      };
    } else {
      throw new Error('Erro ao enviar WhatsApp');
    }
  } catch (error) {
    console.error('[ORDER] Erro ao fazer pedido:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Erro interno do servidor'
      })
    };
  }
};

// Função para enviar WhatsApp
async function sendWhatsAppMessage(phone, message) {
  try {
    console.log(`[WHATSAPP] Enviando para: ${phone}`);
    
    // Delay natural
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

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
      const errorText = await response.text();
      console.error(`[WHATSAPP] Erro HTTP ${response.status}: ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`[WHATSAPP] Sucesso:`, result);
    return true;
  } catch (error) {
    console.error('[WHATSAPP] Erro ao enviar:', error);
    return false;
  }
}
