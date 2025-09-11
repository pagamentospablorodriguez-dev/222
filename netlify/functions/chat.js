const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY || 'AIzaSyAIW7K98cbAdpP-T9QeCdrMqSU9IZWZbRk';

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória
const sessions = new Map();

// Prompt PERFEITO
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. 

PERSONALIDADE:
- Atencioso e prestativo como concierge 5 estrelas
- Mensagens CURTAS (máximo 150 caracteres)
- SEMPRE ofereça opções específicas
- Proativo em sugestões

COLETA DE INFORMAÇÕES (uma por vez):
1. Comida + sabor + tamanho
   - Pizza: "margherita, calabresa, portuguesa, 4 queijos"
   - Hamburger: "clássico, cheese, bacon, frango"
   - Sushi: "tradicional, salmão, hot philadelphia"
   - Tamanhos: "pequena, média, grande, família"
   
2. Sugestões: bebidas, sobremesas
3. Endereço completo 
4. WhatsApp + forma pagamento
5. Se dinheiro: troco (só após saber preço)

TRATAMENTO ESPECIAL:
- Se resposta vaga ("sei lá"): ofereça sugestões específicas
- NUNCA responda só "ok" 
- SEMPRE seja útil

BUSCA DE RESTAURANTES:
- Quando tiver TODAS as 5 informações
- Diga: "Buscando as melhores opções... aguarde"
- Sistema buscará automaticamente

DIRETRIZES:
- Lembre TUDO da conversa
- Uma pergunta por vez
- Opções claras sempre
- Seja direto, sem enrolação
`;

exports.handler = async (event, context) => {
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
        body: JSON.stringify({ error: 'SessionId e message obrigatórios' })
      };
    }

    console.log(`[CHAT] Sessão: ${sessionId}, Mensagem: "${message}"`);

    // Obter ou criar sessão
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        orderData: {
          food: null,
          address: null,
          phone: null,
          paymentMethod: null,
          change: null
        },
        stage: 'collecting_info',
        created: new Date(),
        lastActive: new Date()
      };
      sessions.set(sessionId, session);
    }

    session.lastActive = new Date();

    // Construir contexto
    let context = SYSTEM_PROMPT + "\n\nHistórico da conversa:\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    console.log(`[CHAT] Gerando resposta...`);

    // Gerar resposta
    const result = await model.generateContent(context);
    let aiMessage = result.response.text().trim();

    // Limitar tamanho
    if (aiMessage.length > 150) {
      const sentences = aiMessage.split(/[.!?]+/);
      aiMessage = sentences[0];
      if (!aiMessage.endsWith('.') && !aiMessage.endsWith('!') && !aiMessage.endsWith('?')) {
        aiMessage += '.';
      }
      if (aiMessage.length > 150) {
        aiMessage = aiMessage.substring(0, 147) + '...';
      }
    }

    // Extrair informações
    const messageHistory = messages.map(m => m.content).join(' ') + ' ' + message;
    extractOrderInfo(session, messageHistory, message);

    console.log(`[CHAT] Dados coletados:`, session.orderData);

    // Verificar se tem todas as informações
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    let shouldSearchRestaurants = false;

    // Se tem todas as informações e está falando que vai buscar
    if (hasAllInfo && 
        session.stage === 'collecting_info' && 
        (aiMessage.includes('buscando') || aiMessage.includes('aguard'))) {
      
      session.stage = 'searching';
      shouldSearchRestaurants = true;
      
      console.log(`[CHAT] Iniciando busca para: ${sessionId}`);
    }

    const response = {
      message: aiMessage,
      sessionId: sessionId,
      shouldSearchRestaurants,
      orderData: hasAllInfo ? session.orderData : null
    };

    console.log(`[CHAT] Resposta:`, response);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('[CHAT] Erro:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Extrair informações do pedido
function extractOrderInfo(session, messageHistory, currentMessage) {
  const lower = messageHistory.toLowerCase();

  // Comida
  if (!session.orderData.food && 
      lower.match(/(pizza|hambur|sushi|yakisoba|lanche|mcchicken|big mac|frango|carne|peixe|calabresa|margherita|portuguesa)/)) {
    session.orderData.food = currentMessage;
    console.log(`[EXTRACT] Comida: ${currentMessage}`);
  }

  // Endereço
  if (!session.orderData.address && 
      lower.match(/(rua|av|avenida|endereço|entregar).+?\d+/)) {
    session.orderData.address = currentMessage;
    console.log(`[EXTRACT] Endereço: ${currentMessage}`);
  }

  // Telefone
  if (!session.orderData.phone) {
    const phoneMatch = messageHistory.match(/(\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4})/);
    if (phoneMatch) {
      session.orderData.phone = phoneMatch[0].replace(/\D/g, '');
      console.log(`[EXTRACT] Telefone: ${session.orderData.phone}`);
    }
  }

  // Pagamento
  if (!session.orderData.paymentMethod) {
    if (lower.includes('dinheiro') || lower.includes('espécie')) {
      session.orderData.paymentMethod = 'dinheiro';
    } else if (lower.includes('cartão') || lower.includes('cartao')) {
      session.orderData.paymentMethod = 'cartão';
    } else if (lower.includes('pix')) {
      session.orderData.paymentMethod = 'pix';
    }
  }

  // Troco
  if (session.orderData.paymentMethod === 'dinheiro' && !session.orderData.change) {
    const changeMatch = messageHistory.match(/(\d+)\s*reais?/i);
    if (changeMatch) {
      session.orderData.change = changeMatch[1];
      console.log(`[EXTRACT] Troco: ${session.orderData.change}`);
    }
  }
}
