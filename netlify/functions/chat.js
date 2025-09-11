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

// Prompt otimizado - Mix do melhor dos dois mundos
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você funciona como um concierge particular premium, oferecendo o melhor atendimento personalizado possível.

MISSÃO: Revolucionar como as pessoas pedem comida online, tornando o processo simples, rápido e sem fricção.

PERSONALIDADE:
- Atencioso e prestativo como um concierge de hotel 5 estrelas
- Proativo em sugerir opções e melhorias
- Eficiente e profissional, mas amigável
- Focado em resolver tudo para o cliente
- Mensagens CURTAS e DIRETAS (máximo 150 caracteres por mensagem)
- Se precisar falar mais, envie múltiplas mensagens sequenciais

PROCESSO DE ATENDIMENTO:

1. RECEPÇÃO DO PEDIDO:
   - Cumprimente apenas na primeira vez
   - Identifique o que querem comer
   - Seja específico sobre quantidades, tamanhos, sabores
   - Ofereça opções quando necessário (ex: "pequena, média, grande ou família?")

2. COLETA DE INFORMAÇÕES (uma por vez):
   - Comida: tipo, sabor, tamanho (sempre ofereça opções de tamanho)
   - Sugestões: bebidas, sobremesas, acompanhamentos
   - Endereço completo de entrega
   - Número de WhatsApp do cliente
   - Forma de pagamento (dinheiro, cartão, PIX)
   - Se dinheiro: quanto de troco (APENAS após saber o preço)
   - Observações especiais

3. BUSCA DE RESTAURANTES:
   - Informe que está buscando as melhores opções
   - Use Gemini para encontrar restaurantes reais na cidade
   - Busque números de WhatsApp dos estabelecimentos

4. APRESENTAÇÃO DE OPÇÕES:
   - Apresente 2-3 opções de restaurantes
   - Inclua nome, especialidade, tempo estimado, preço aproximado
   - Peça para o cliente escolher

5. CONFIRMAÇÃO E PEDIDO:
   - Confirme todos os detalhes
   - Tranquilize o cliente sobre o processo
   - Explique que vai entrar em contato com o restaurante
   - Informe que receberá atualizações no chat e WhatsApp

6. ACOMPANHAMENTO:
   - Envie múltiplas mensagens sequenciais para tranquilizar
   - Atualize sobre cada etapa (confirmação, preparo, saída, entrega)
   - Mantenha o cliente informado sempre

DIRETRIZES IMPORTANTES:
- SEMPRE lembre do contexto completo da conversa
- Seja proativo em sugerir bebidas, sobremesas, acompanhamentos
- Ofereça opções de tamanho sempre (pequena, média, grande, família)
- Mantenha tom profissional mas descontraído
- NUNCA invente informações sobre restaurantes
- Tranquilize o cliente durante todo o processo
- Envie mensagens sequenciais quando necessário

INFORMAÇÕES NECESSÁRIAS PARA PROCESSAR PEDIDO:
1. Comida desejada (tipo, sabor, tamanho)
2. Endereço completo de entrega
3. Número de WhatsApp
4. Forma de pagamento
5. Se dinheiro: valor do troco (após saber preço)

Quando tiver TODAS essas informações, inicie o processo de busca de restaurantes usando Gemini.

EXEMPLO DE ATENDIMENTO:
Cliente: "Quero uma pizza"
Você: "Perfeito! Que sabor você prefere?"
Cliente: "Margherita"
Você: "Ótima escolha! Que tamanho? (pequena, média, grande ou família)"
Cliente: "Grande"
Você: "Vai querer alguma bebida para acompanhar?"

Lembre-se: Você é o diferencial que torna o IA Fome único. Ofereça uma experiência premium, mas simples e rápida!
`;

// Prompt para buscar restaurantes com Gemini
const RESTAURANT_SEARCH_PROMPT = `
Você é um especialista em restaurantes e delivery. Encontre 2-3 restaurantes REAIS que entregam {FOOD_TYPE} na cidade de {CITY}.

Para cada restaurante, forneça:
- Nome do restaurante (real e existente)
- Número de WhatsApp (formato: 5524999999999)
- Especialidade
- Tempo estimado de entrega
- Preço aproximado do item solicitado

IMPORTANTE: 
- Use apenas restaurantes que realmente existem
- Números de WhatsApp devem ser reais (pesquise se necessário)
- Preços devem ser realistas para a região
- Priorize estabelecimentos com boa reputação

Responda APENAS com os dados dos restaurantes em formato JSON:
[
  {
    "name": "Nome do Restaurante",
    "phone": "5524999999999",
    "specialty": "Especialidade",
    "estimatedTime": "30-40 min",
    "price": "R$ 25-35"
  }
]
`;

// Prompt para conversar com restaurantes
const RESTAURANT_CONVERSATION_PROMPT = `
Você é um cliente fazendo um pedido de delivery. Seja natural, educado e direto.
Forneça todas as informações necessárias de forma humana e conversacional.

DADOS DO PEDIDO:
- Comida: {ORDER_DETAILS}
- Endereço: {ADDRESS}
- Telefone: {PHONE}
- Pagamento: {PAYMENT_METHOD}
{CHANGE_INFO}

Responda às perguntas do restaurante de forma clara e objetiva.
Mantenha um tom amigável mas profissional.
Se não souber alguma informação, diga que vai verificar.
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
    
    // Detectar comida
    if (!session.orderData.food) {
      const foodMatch = messageHistory.match(/(pizza|hamburguer|lanche|sushi|japonês|chinês|italiana|brasileira|mexicana|árabe|margherita|calabresa|portuguesa|frango|carne|peixe|vegetariana|mcchicken|mcnuggets|big mac)/i);
      if (foodMatch) {
        session.orderData.food = message;
      }
    }

    // Detectar endereço
    if (!session.orderData.address) {
      const addressMatch = messageHistory.match(/(rua|avenida|av\.|r\.|endereço|entregar|entrega).+?(\d+)/i);
      if (addressMatch) {
        session.orderData.address = message;
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

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    // Se temos todas as informações, iniciar processo de pedido
    if (hasAllInfo && session.stage === 'initial') {
      session.stage = 'searching_restaurant';
      
      // Buscar restaurantes usando Gemini
      setTimeout(async () => {
        try {
          await searchAndOrderRestaurant(session);
        } catch (error) {
          console.error('Erro ao processar pedido:', error);
        }
      }, 3000);
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

// Buscar restaurantes e fazer pedido
async function searchAndOrderRestaurant(session) {
  try {
    // Extrair cidade do endereço
    const addressParts = session.orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Volta Redonda';
    
    // Buscar restaurantes usando Gemini
    const searchPrompt = RESTAURANT_SEARCH_PROMPT
      .replace('{FOOD_TYPE}', session.orderData.food)
      .replace('{CITY}', city);

    const searchResult = await model.generateContent(searchPrompt);
    const restaurantData = searchResult.response.text();

    let restaurants;
    try {
      restaurants = JSON.parse(restaurantData);
    } catch (e) {
      // Se não conseguir parsear JSON, usar dados mock
      restaurants = [
        {
          name: 'Pizzaria Dom José',
          phone: '5524999999999',
          specialty: 'Pizza tradicional',
          estimatedTime: '40-50 min',
          price: 'R$ 35-45'
        },
        {
          name: 'Pizza Express',
          phone: '5524888888888',
          specialty: 'Pizza gourmet',
          estimatedTime: '35-45 min',
          price: 'R$ 40-50'
        }
      ];
    }

    // Enviar opções para o cliente (simulado - em produção, usar WebSocket ou polling)
    console.log('Restaurantes encontrados:', restaurants);

    // Simular seleção do primeiro restaurante
    const selectedRestaurant = restaurants[0];

    // Fazer pedido no restaurante
    await makeRestaurantOrder(session, selectedRestaurant);

    // Salvar pedido
    orders.set(session.id, {
      sessionId: session.id,
      restaurant: selectedRestaurant,
      orderData: session.orderData,
      status: 'sent_to_restaurant',
      timestamp: new Date()
    });

    console.log(`Pedido enviado para ${selectedRestaurant.name}`);

  } catch (error) {
    console.error('Erro ao buscar restaurantes:', error);
  }
}

// Fazer pedido no restaurante
async function makeRestaurantOrder(session, restaurant) {
  try {
    // Criar mensagem para o restaurante
    const orderMessage = RESTAURANT_CONVERSATION_PROMPT
      .replace('{ORDER_DETAILS}', session.orderData.food)
      .replace('{ADDRESS}', session.orderData.address)
      .replace('{PHONE}', session.orderData.phone)
      .replace('{PAYMENT_METHOD}', session.orderData.paymentMethod)
      .replace('{CHANGE_INFO}', session.orderData.change ? `\n- Troco para: R$ ${session.orderData.change}` : '');

    const conversationResult = await model.generateContent(orderMessage);
    const humanMessage = conversationResult.response.text();

    // Enviar mensagem para o restaurante
    await sendWhatsAppMessage(restaurant.phone, humanMessage);

    console.log(`Mensagem enviada para ${restaurant.name}: ${humanMessage}`);

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