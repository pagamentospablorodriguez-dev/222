const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória (em produção, usar banco de dados)
const sessions = new Map();
const orders = new Map();

// Prompt do sistema para o IA Fome
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você é um concierge particular premium que oferece atendimento rápido, direto e eficiente.

PERSONALIDADE:
- Direto e objetivo, sem enrolação
- Amigável mas focado no resultado
- Eficiente como um concierge premium
- Não repete cumprimentos se já fez antes na conversa

PROCESSO SIMPLIFICADO:

1. PRIMEIRA INTERAÇÃO:
   - Cumprimente apenas uma vez por sessão
   - Pergunte diretamente o que quer comer

2. COLETA RÁPIDA DE INFORMAÇÕES:
   - Comida desejada (tipo, tamanho, sabor)
   - Endereço completo de entrega
   - Número de WhatsApp
   - Forma de pagamento (dinheiro, cartão, pix)
   - Se dinheiro: quanto de troco precisa
   - Observações especiais (se houver)

3. CONFIRMAÇÃO E BUSCA:
   - Confirme os dados rapidamente
   - Informe que está buscando os melhores restaurantes
   - Apresente 2-3 opções com preços estimados

4. FINALIZAÇÃO:
   - Confirme a escolha
   - Inicie contato com restaurante
   - Mantenha cliente informado

REGRAS IMPORTANTES:
- Mensagens curtas e diretas
- Não cumprimente novamente se já fez na conversa
- Aceite informações em partes (mensagens picotadas)
- Salve TODAS as informações fornecidas
- Seja prático e rápido
- Foque no resultado, não na conversa

EXEMPLO DE FLUXO:
Cliente: "Quero uma pizza"
Você: "Ótimo! Que sabor e tamanho você prefere?"

Cliente: "Margherita grande"
Você: "Perfeito! Preciso do seu endereço para entrega."

Cliente: "Rua A, 123, Centro"
Você: "E seu WhatsApp para atualizações?"

E assim por diante, sempre direto ao ponto.

Lembre-se: Você é um concierge premium focado em RESULTADOS, não em conversas longas!
`;

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
    const { sessionId, message, messages = [] } = JSON.parse(event.body);

    if (!sessionId || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'SessionId e message são obrigatórios' })
      };
    }

    // Obter ou criar sessão
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        userPhone: null,
        userAddress: null,
        orderDetails: {
          food: null,
          address: null,
          phone: null,
          paymentMethod: null,
          change: null,
          observations: null
        },
        stage: 'initial',
        created: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        hasGreeted: false
      };
      sessions.set(sessionId, session);
    }

    // Atualizar sessão
    session.lastActive = new Date().toISOString();
    session.messages = messages;

    // Extrair informações da mensagem atual
    extractOrderInfo(session, message);

    // Construir contexto da conversa
    let context = SYSTEM_PROMPT + "\n\nInformações já coletadas:\n";
    context += `- Comida: ${session.orderDetails.food || 'Não informado'}\n`;
    context += `- Endereço: ${session.orderDetails.address || 'Não informado'}\n`;
    context += `- WhatsApp: ${session.orderDetails.phone || 'Não informado'}\n`;
    context += `- Pagamento: ${session.orderDetails.paymentMethod || 'Não informado'}\n`;
    context += `- Troco: ${session.orderDetails.change || 'Não informado'}\n`;
    context += `- Observações: ${session.orderDetails.observations || 'Nenhuma'}\n`;
    context += `- Já cumprimentou: ${session.hasGreeted ? 'Sim' : 'Não'}\n\n`;
    
    context += "Histórico da conversa:\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    // Marcar que já cumprimentou
    if (!session.hasGreeted) {
      session.hasGreeted = true;
    }

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    const aiMessage = response.text().trim();

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderDetails.food && 
                      session.orderDetails.address && 
                      session.orderDetails.phone && 
                      session.orderDetails.paymentMethod;

    // Se temos todas as informações, iniciar busca de restaurantes
    if (hasAllInfo && session.stage === 'initial') {
      session.stage = 'searching_restaurants';
      
      // Buscar restaurantes e fazer pedido
      setTimeout(async () => {
        try {
          await processOrder(session);
        } catch (error) {
          console.error('Erro ao processar pedido:', error);
        }
      }, 2000);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: aiMessage,
        sessionId: sessionId
      })
    };

  } catch (error) {
    console.error('Erro no chat:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Extrair informações do pedido da mensagem
function extractOrderInfo(session, message) {
  const lowerMessage = message.toLowerCase();
  
  // Extrair comida
  if (!session.orderDetails.food) {
    const foodKeywords = ['pizza', 'hamburguer', 'lanche', 'sushi', 'japonês', 'chinês', 'italiana', 'brasileira', 'mexicana', 'árabe', 'margherita', 'calabresa', 'portuguesa'];
    for (const keyword of foodKeywords) {
      if (lowerMessage.includes(keyword)) {
        session.orderDetails.food = message;
        break;
      }
    }
  }

  // Extrair endereço
  if (!session.orderDetails.address && (lowerMessage.includes('rua') || lowerMessage.includes('av') || lowerMessage.includes('endereço'))) {
    session.orderDetails.address = message;
  }

  // Extrair telefone
  const phoneMatch = message.match(/(\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4})/);
  if (phoneMatch && !session.orderDetails.phone) {
    session.orderDetails.phone = phoneMatch[0].replace(/\D/g, '');
  }

  // Extrair forma de pagamento
  if (!session.orderDetails.paymentMethod) {
    if (lowerMessage.includes('dinheiro')) {
      session.orderDetails.paymentMethod = 'dinheiro';
    } else if (lowerMessage.includes('cartão') || lowerMessage.includes('cartao')) {
      session.orderDetails.paymentMethod = 'cartão';
    } else if (lowerMessage.includes('pix')) {
      session.orderDetails.paymentMethod = 'pix';
    }
  }

  // Extrair troco
  const changeMatch = message.match(/troco.*?(\d+)/i);
  if (changeMatch && !session.orderDetails.change) {
    session.orderDetails.change = changeMatch[1];
  }
}

// Processar pedido completo
async function processOrder(session) {
  try {
    // 1. Buscar restaurantes
    const restaurants = await searchRestaurants(session.orderDetails.food, session.orderDetails.address);
    
    if (restaurants.length === 0) {
      console.log('Nenhum restaurante encontrado');
      return;
    }

    // 2. Escolher melhor restaurante
    const bestRestaurant = restaurants[0];
    
    // 3. Salvar pedido
    const order = {
      sessionId: session.id,
      restaurant: bestRestaurant,
      details: session.orderDetails,
      status: 'contacting_restaurant',
      created: new Date().toISOString()
    };
    orders.set(session.id, order);

    // 4. Fazer pedido no restaurante
    await makeOrderToRestaurant(order);

  } catch (error) {
    console.error('Erro ao processar pedido:', error);
  }
}

// Buscar restaurantes usando Gemini
async function searchRestaurants(foodType, address) {
  try {
    const searchPrompt = `
    Você é um especialista em restaurantes. Preciso que você me forneça informações sobre os 3 melhores restaurantes de ${foodType} na região de ${address}.

    Para cada restaurante, forneça APENAS em formato JSON válido:
    [
      {
        "name": "Nome do Restaurante",
        "phone": "5524999999999",
        "address": "Endereço completo",
        "rating": 4.5,
        "estimatedTime": "40-50 min",
        "estimatedPrice": "R$ 35-45"
      }
    ]

    Responda APENAS o JSON, sem texto adicional.
    `;

    const result = await model.generateContent(searchPrompt);
    const response = result.response.text();
    
    try {
      return JSON.parse(response);
    } catch {
      // Fallback para dados mock
      return [
        {
          name: 'Pizzaria Dom José',
          phone: '5524999999999',
          address: 'Rua das Pizzas, 123',
          rating: 4.5,
          estimatedTime: '40-50 min',
          estimatedPrice: 'R$ 35-45'
        }
      ];
    }

  } catch (error) {
    console.error('Erro na busca:', error);
    return [];
  }
}

// Fazer pedido no restaurante via WhatsApp
async function makeOrderToRestaurant(order) {
  try {
    const orderMessage = `Olá! Gostaria de fazer um pedido para entrega:

📋 *PEDIDO:*
${order.details.food}

📍 *ENDEREÇO:*
${order.details.address}

💳 *PAGAMENTO:*
${order.details.paymentMethod}${order.details.change ? ` (Troco para R$ ${order.details.change})` : ''}

📱 *CONTATO:*
${order.details.phone}

${order.details.observations ? `📝 *OBSERVAÇÕES:*\n${order.details.observations}` : ''}

Poderia me confirmar o valor total e o tempo de entrega?

Obrigado!`;

    await sendWhatsAppMessage(order.restaurant.phone, orderMessage);
    
    console.log(`Pedido enviado para ${order.restaurant.name}`);

  } catch (error) {
    console.error('Erro ao fazer pedido:', error);
  }
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
