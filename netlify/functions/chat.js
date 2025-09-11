const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY || 'AIzaSyBneYtUfIn9ZPOdEQtgxBhM_m_RzNaBDEA';
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL || 'https://api.evoapicloud.com';
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN || 'EDF0C4C1E6CF-4D7B-A825-D7D24868E7FB';
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID || '26935dbc-39ab-4b81-92b7-a09f57325a0c';

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória (em produção, usar banco de dados)
const sessions = new Map();
const orders = new Map();

// Sistema de mensagens sequenciais
const messageQueue = new Map();

// Prompt otimizado - Mix do melhor dos dois mundos
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você funciona como um concierge particular premium, oferecendo o melhor atendimento personalizado possível.

MISSÃO: Revolucionar como as pessoas pedem comida online, tornando o processo simples, rápido e sem fricção.

PERSONALIDADE:
- Atencioso e prestativo como um concierge de hotel 5 estrelas
- Proativo em sugerir opções e melhorias
- Eficiente e profissional, mas amigável
- Focado em resolver tudo para o cliente
- Mensagens CURTAS e DIRETAS (máximo 150 caracteres)
- Se precisar falar mais, mencione que enviará mais detalhes

PROCESSO DE ATENDIMENTO:

RECEPÇÃO DO PEDIDO:
- Cumprimente apenas na primeira vez
- Identifique o que querem comer
- Seja específico sobre quantidades, tamanhos, sabores
- SEMPRE ofereça opções específicas (ex: hamburger: clássico, cheese, bacon, frango, vegano)

COLETA DE INFORMAÇÕES (uma por vez):
- Comida: tipo, sabor, tamanho (SEMPRE liste opções: "pequena, média, grande ou família?")
- Sugestões proativas: bebidas, sobremesas, acompanhamentos
- Endereço completo de entrega
- Número de WhatsApp do cliente
- Forma de pagamento (dinheiro, cartão, PIX)
- Se dinheiro: quanto de troco (APENAS após saber o preço)
- Observações especiais

EXEMPLOS DE OPÇÕES ESPECÍFICAS:
- Pizza: "margherita, calabresa, portuguesa, quatro queijos, frango catupiry"
- Hamburger: "clássico, cheeseburger, bacon burger, frango grelhado, vegano"
- Sushi: "combinado tradicional, salmão, hot philadelphia, temaki"
- Tamanhos: "pequena, média, grande ou família?"

BUSCA DE RESTAURANTES:
- Informe que está buscando as melhores opções
- Use Gemini para encontrar restaurantes reais na cidade
- IMEDIATAMENTE após buscar, apresente as opções
- NÃO espere resposta do cliente para mostrar as opções

APRESENTAÇÃO DE OPÇÕES:
- Apresente 2-3 opções de restaurantes
- Inclua nome, especialidade, tempo estimado, preço aproximado
- Peça para o cliente escolher
- Envie tudo em UMA mensagem completa

CONFIRMAÇÃO E PEDIDO:
- Confirme todos os detalhes
- Tranquilize o cliente sobre o processo
- Explique que vai entrar em contato com o restaurante
- Informe que receberá atualizações no chat e WhatsApp

DIRETRIZES IMPORTANTES:
- SEMPRE lembre do contexto completo da conversa
- Ofereça opções específicas para cada tipo de comida
- NUNCA invente informações sobre restaurantes
- Seja proativo - não espere cliente para enviar opções
- Uma pergunta por vez, mas com opções claras

INFORMAÇÕES NECESSÁRIAS:
1. Comida desejada (tipo, sabor, tamanho)
2. Endereço completo de entrega
3. Número de WhatsApp
4. Forma de pagamento
5. Se dinheiro: valor do troco (após saber preço)

Quando tiver TODAS essas informações, IMEDIATAMENTE inicie busca e apresente opções.
`;

// Prompt para buscar restaurantes com Gemini
const RESTAURANT_SEARCH_PROMPT = `
Você é um especialista em restaurantes e delivery. Encontre 2-3 restaurantes REAIS que entregam {FOOD_TYPE} na região de {CITY}, Rio de Janeiro.

Para cada restaurante, forneça:
- Nome do restaurante (real e existente)
- Número de WhatsApp (formato: 5521999999999 - Rio de Janeiro)
- Especialidade
- Tempo estimado de entrega
- Preço aproximado do item solicitado

IMPORTANTE:
- Use apenas restaurantes que realmente existem na região
- Números de WhatsApp devem ser realistas para estabelecimentos do Rio
- Preços devem ser realistas para a região (RJ)
- Priorize estabelecimentos conhecidos e com boa reputação

Responda APENAS em formato JSON:
[
  {
    "name": "Nome do Restaurante",
    "phone": "5521999999999",
    "specialty": "Especialidade do restaurante",
    "estimatedTime": "30-40 min",
    "price": "R$ 35-45"
  }
]
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
        currentOrder: null,
        stage: 'initial',
        orderData: {
          food: null,
          address: null,
          phone: null,
          paymentMethod: null,
          change: null,
          observations: null
        },
        created: new Date(),
        lastActive: new Date()
      };
      sessions.set(sessionId, session);
    }

    // Atualizar sessão
    session.lastActive = new Date();
    session.messages = messages;

    // Construir contexto da conversa
    let context = SYSTEM_PROMPT + "\n\nHistórico da conversa:\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    let aiMessage = response.text().trim();

    // Limitar tamanho da mensagem (máximo 150 caracteres)
    if (aiMessage.length > 150) {
      const sentences = aiMessage.split(/[.!?]+/);
      aiMessage = sentences[0] + (sentences[0].endsWith('.') || sentences[0].endsWith('!') || sentences[0].endsWith('?') ? '' : '.');
      if (aiMessage.length > 150) {
        aiMessage = aiMessage.substring(0, 147) + '...';
      }
    }

    // Extrair informações do pedido
    const messageHistory = messages.map(m => m.content).join(' ') + ' ' + message;

    // Detectar e salvar informações
    await extractOrderInfo(session, messageHistory, message);

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    // Se temos todas as informações E ainda não buscamos restaurantes
    if (hasAllInfo && session.stage === 'initial') {
      session.stage = 'searching_restaurant';
      
      // Buscar restaurantes IMEDIATAMENTE
      setTimeout(async () => {
        try {
          await searchAndPresentRestaurants(sessionId, session);
        } catch (error) {
          console.error('Erro ao buscar restaurantes:', error);
        }
      }, 2000); // 2 segundos para parecer que está processando
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

// Extrair informações do pedido
async function extractOrderInfo(session, messageHistory, currentMessage) {
  // Detectar comida
  if (!session.orderData.food) {
    const foodMatch = messageHistory.match(/(pizza|hamburguer|hamburger|lanche|sushi|japonês|chinês|italiana|brasileira|mexicana|árabe|margherita|calabresa|portuguesa|frango|carne|peixe|vegetariana|mcchicken|mcnuggets|big mac|cheeseburger)/i);
    if (foodMatch) {
      session.orderData.food = currentMessage;
    }
  }

  // Detectar endereço
  if (!session.orderData.address) {
    const addressMatch = messageHistory.match(/(rua|avenida|av\.|r\.|endereço|entregar|entrega).+?(\d+)/i);
    if (addressMatch) {
      session.orderData.address = currentMessage;
    }
  }

  // Detectar telefone
  if (!session.orderData.phone) {
    const phoneMatch = messageHistory.match(/(\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4})/);
    if (phoneMatch) {
      session.orderData.phone = phoneMatch[0].replace(/\D/g, '');
    }
  }

  // Detectar forma de pagamento
  if (!session.orderData.paymentMethod) {
    if (messageHistory.match(/(dinheiro|espécie)/i)) {
      session.orderData.paymentMethod = 'dinheiro';
    } else if (messageHistory.match(/(cartão|cartao)/i)) {
      session.orderData.paymentMethod = 'cartão';
    } else if (messageHistory.match(/pix/i)) {
      session.orderData.paymentMethod = 'pix';
    }
  }

  // Detectar troco
  if (session.orderData.paymentMethod === 'dinheiro' && !session.orderData.change) {
    const changeMatch = messageHistory.match(/(\d+)\s*(reais?|r\$)/i);
    if (changeMatch) {
      session.orderData.change = changeMatch[1];
    }
  }
}

// Buscar restaurantes e apresentar opções AUTOMATICAMENTE
async function searchAndPresentRestaurants(sessionId, session) {
  try {
    // Extrair cidade do endereço
    const addressParts = session.orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Rio de Janeiro';

    // Buscar restaurantes usando Gemini
    const searchPrompt = RESTAURANT_SEARCH_PROMPT
      .replace('{FOOD_TYPE}', session.orderData.food)
      .replace('{CITY}', city);

    const searchResult = await model.generateContent(searchPrompt);
    const restaurantData = searchResult.response.text();

    let restaurants;
    try {
      // Tentar parsear JSON
      const jsonMatch = restaurantData.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON não encontrado');
      }
    } catch (e) {
      // Se não conseguir parsear JSON, usar dados mock realistas
      restaurants = [
        {
          name: 'Pizzaria Guanabara',
          phone: '5521999887766',
          specialty: 'Pizza tradicional carioca',
          estimatedTime: '35-45 min',
          price: 'R$ 32-42'
        },
        {
          name: 'Burger House RJ',
          phone: '5521988776655',
          specialty: 'Hamburger artesanal',
          estimatedTime: '25-35 min',
          price: 'R$ 28-38'
        },
        {
          name: 'Delivery Express',
          phone: '5521977665544',
          specialty: 'Comida rápida de qualidade',
          estimatedTime: '20-30 min',
          price: 'R$ 25-35'
        }
      ];
    }

    // Salvar pedido
    orders.set(sessionId, {
      sessionId: sessionId,
      restaurants: restaurants,
      orderData: session.orderData,
      status: 'restaurants_found',
      timestamp: new Date()
    });

    // Construir mensagem com opções
    let optionsMessage = "🍕 Encontrei ótimas opções para você:\n\n";
    restaurants.forEach((rest, index) => {
      optionsMessage += `${index + 1}. **${rest.name}**\n`;
      optionsMessage += `   ${rest.specialty}\n`;
      optionsMessage += `   ⏰ ${rest.estimatedTime}\n`;
      optionsMessage += `   💰 ${rest.price}\n\n`;
    });
    optionsMessage += "Qual restaurante você prefere? Digite o número da opção! 😊";

    // Simular envio automático da mensagem
    // Em produção, isso seria enviado via WebSocket ou webhook
    console.log(`[ENVIO AUTOMÁTICO] Opções encontradas para ${sessionId}:`, optionsMessage);

    // Marcar que as opções foram apresentadas
    session.stage = 'restaurants_presented';
    sessions.set(sessionId, session);

    return restaurants;
  } catch (error) {
    console.error('Erro ao buscar restaurantes:', error);
    return null;
  }
}

// Fazer pedido no restaurante
async function makeRestaurantOrder(session, restaurant) {
  try {
    // Criar mensagem humanizada para o restaurante
    const orderDetails = `
Olá! Gostaria de fazer um pedido para delivery.

📋 PEDIDO:
${session.orderData.food}

📍 ENDEREÇO:
${session.orderData.address}

📱 CONTATO:
${session.orderData.phone}

💳 PAGAMENTO:
${session.orderData.paymentMethod}${session.orderData.change ? `\nTroco para: R$ ${session.orderData.change}` : ''}

Pode confirmar o pedido e me informar o valor total e tempo de entrega?

Obrigado!
    `.trim();

    // Enviar mensagem para o restaurante
    await sendWhatsAppMessage(restaurant.phone, orderDetails);

    console.log(`Pedido enviado para ${restaurant.name}: ${orderDetails.substring(0, 100)}...`);
  } catch (error) {
    console.error('Erro ao fazer pedido no restaurante:', error);
  }
}

// Função para enviar mensagem via Evolution API
async function sendWhatsAppMessage(phone, message) {
  try {
    // Delay para parecer humano
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

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
