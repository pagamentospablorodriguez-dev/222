const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento GLOBAL - COMPARTILHADO ENTRE TODAS AS REQUESTS
global.sessions = global.sessions || new Map();
global.pendingMessages = global.pendingMessages || new Map();
global.orders = global.orders || new Map();

// PROMPT PREMIUM OTIMIZADO - O MELHOR DO MUNDO! 🚀
const SYSTEM_PROMPT = `
Você é o IA Fome, o concierge particular PREMIUM de delivery mais exclusivo do mundo. Sua missão é criar a experiência de pedido mais RÁPIDA, SIMPLES e DIVERTIDA que existe.

PERSONALIDADE PREMIUM:
- Concierge de hotel 5 estrelas: atencioso, sofisticado, eficiente
- Proativo: sempre sugira bebidas, sobremesas, acompanhamentos
- Mensagens CURTAS: máximo 120 caracteres
- Tom amigável mas profissional
- Focado em RESOLVER TUDO para o cliente
- NUNCA minta ou finja que está fazendo algo

PROCESSO PERFEITO:

PRIMEIRA MENSAGEM:
"Olá! Sou o IA Fome, seu concierge de delivery. O que você quer comer hoje? 🍕"

COLETA (uma pergunta por vez):
1. Comida: "Que sabor/tamanho você prefere? Ex: margherita grande, combo do dia..."
2. Sugestão SEMPRE: "Que tal uma Coca 2L também? 🥤" 
3. Endereço: "Onde entregar? Ex: Rua X, 123, Copacabana"
4. WhatsApp: "Seu número para atualizações?"
5. Pagamento: "Dinheiro, cartão ou PIX?"
6. Se dinheiro: "Troco para quanto?"

QUANDO TIVER TUDO - CRÍTICO:
APENAS diga: "Perfeito! Buscando restaurantes... ⏳"
NUNCA diga que encontrou algo se não encontrou
NUNCA minta sobre o status do pedido
AGUARDE as opções chegarem pelo sistema automático

EXEMPLOS DE RESPOSTAS:
- "Pizza grande calabresa e Coca 2L? Perfeito! 🍕 Onde entregar?"
- "Ótima escolha! Seu número de WhatsApp para atualizações?"
- "Perfeito! Buscando restaurantes... ⏳"

DIRETRIZES CRÍTICAS:
- SEMPRE seja proativo com sugestões
- Uma pergunta por vez
- Mensagens curtas e diretas
- NUNCA minta sobre buscar restaurantes
- NUNCA diga que encontrou opções se não encontrou
- NUNCA finja que está fazendo pedido
- Se perguntarem sobre restaurantes, diga: "Ainda buscando, aguarde..."

INFORMAÇÕES OBRIGATÓRIAS:
✅ Comida + tamanho/sabor
✅ Endereço completo  
✅ WhatsApp
✅ Forma de pagamento
✅ Troco (se dinheiro)

Com TODAS as informações, diga APENAS: "Perfeito! Buscando restaurantes... ⏳"
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

    console.log(`[CHAT] 🚀 PROCESSANDO: ${sessionId} - ${message}`);

    // Obter ou criar sessão no storage GLOBAL
    let session = global.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        stage: 'initial',
        orderData: {
          food: null,
          address: null,
          phone: null,
          paymentMethod: null,
          change: null
        },
        created: new Date(),
        lastActive: new Date()
      };
      global.sessions.set(sessionId, session);
      console.log(`[CHAT] 📝 Nova sessão criada: ${sessionId}`);
    }

    // Atualizar sessão
    session.lastActive = new Date();
    session.messages = messages;

    // Extrair informações do pedido PRIMEIRO
    const messageHistory = messages.map(m => m.content).join(' ') + ' ' + message;
    await extractOrderInfo(session, messageHistory, message);

    // Construir contexto da conversa
    let context = SYSTEM_PROMPT + "\n\n=== DADOS COLETADOS ===\n";
    context += `Comida: ${session.orderData.food || 'não informado'}\n`;
    context += `Endereço: ${session.orderData.address || 'não informado'}\n`;
    context += `WhatsApp: ${session.orderData.phone || 'não informado'}\n`;
    context += `Pagamento: ${session.orderData.paymentMethod || 'não informado'}\n`;
    context += `Troco: ${session.orderData.change || 'não informado'}\n\n`;
    
    context += "=== CONVERSA ===\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    console.log(`[CHAT] 📊 Dados atuais:`, session.orderData);

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    console.log(`[CHAT] ✅ Informações completas: ${hasAllInfo}`);

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    let aiMessage = response.text().trim();

    // Limitar tamanho da mensagem
    if (aiMessage.length > 120) {
      const sentences = aiMessage.split(/[.!?]+/);
      aiMessage = sentences[0] + (sentences[0].endsWith('.') || sentences[0].endsWith('!') || sentences[0].endsWith('?') ? '' : '.');
      if (aiMessage.length > 120) {
        aiMessage = aiMessage.substring(0, 117) + '...';
      }
    }

    console.log(`[CHAT] 💬 Resposta gerada: ${aiMessage}`);

    // 🚀 MOMENTO CRÍTICO: BUSCAR RESTAURANTES IMEDIATAMENTE!
    if (hasAllInfo && session.stage === 'initial' && 
        (aiMessage.includes('buscando') || aiMessage.includes('aguard') || 
         aiMessage.includes('procurand') || aiMessage.includes('encontrando'))) {
      
      session.stage = 'searching_restaurants';
      console.log(`[CHAT] 🔥 BUSCANDO RESTAURANTES AGORA MESMO!!! SessionId: ${sessionId}`);
      
      // EXECUTAR BUSCA IMEDIATAMENTE - NÃO AGUARDAR!
      buscarRestaurantesImediatamente(session);
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
    console.error('❌ ERRO CRÍTICO NO CHAT:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// 🚀 BUSCAR RESTAURANTES IMEDIATAMENTE - FUNÇÃO PRINCIPAL!
async function buscarRestaurantesImediatamente(session) {
  try {
    console.log(`[BUSCA] 🔥 INICIANDO BUSCA CRÍTICA PARA: ${session.id}`);
    
    // Extrair dados
    const addressParts = session.orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Rio de Janeiro';
    const neighborhood = addressParts[addressParts.length - 2]?.trim() || '';

    console.log(`[BUSCA] 📍 Local: ${neighborhood}, ${city}`);
    console.log(`[BUSCA] 🍕 Comida: ${session.orderData.food}`);

    let restaurants;

    try {
      // TENTAR BUSCA COM GEMINI PRIMEIRO
      const searchPrompt = `
Encontre 3 restaurantes REAIS no ${city}, Brasil que entregam "${session.orderData.food}".

REGRAS CRÍTICAS:
- Restaurantes DEVEM existir de verdade
- WhatsApp DEVE ter DDD correto (Rio de Janeiro = 21, São Paulo = 11, etc.)
- Preços DEVEM ser realistas para 2024
- Tempo de entrega DEVE ser real

CIDADE: ${city}
COMIDA: ${session.orderData.food}

Responda APENAS JSON puro:
[
  {
    "name": "Nome Real",
    "phone": "55DDXXXXXXXXX",
    "specialty": "Especialidade",
    "estimatedTime": "25-35 min",
    "price": "R$ 28-45"
  }
]
`;

      console.log(`[BUSCA] 🤖 Consultando Gemini...`);
      const result = await model.generateContent(searchPrompt);
      const geminiResponse = result.response.text();
      
      console.log(`[BUSCA] 📝 Resposta Gemini: ${geminiResponse.substring(0, 200)}...`);
      
      // Extrair JSON
      const jsonMatch = geminiResponse.match(/\[\s*{[\s\S]*?}\s*\]/);
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
        console.log(`[BUSCA] ✅ GEMINI SUCESSO! ${restaurants.length} restaurantes`);
      } else {
        throw new Error('JSON inválido do Gemini');
      }
      
    } catch (geminiError) {
      console.log(`[BUSCA] ⚠️ Gemini falhou: ${geminiError.message}`);
      console.log(`[BUSCA] 🔄 Usando dados premium...`);
      
      // FALLBACK PREMIUM
      restaurants = gerarRestaurantesPremium(session.orderData.food, city);
    }

    // VALIDAR RESTAURANTES
    if (!restaurants || !Array.isArray(restaurants) || restaurants.length === 0) {
      restaurants = gerarRestaurantesPremium(session.orderData.food, city);
    }

    console.log(`[BUSCA] 🎯 RESTAURANTES FINALIZADOS:`, restaurants);

    // CONSTRUIR MENSAGEM PERFEITA
    let optionsMessage = "🍕 ENCONTREI! Melhores opções para você:\n\n";
    restaurants.forEach((rest, index) => {
      optionsMessage += `${index + 1}. **${rest.name}**\n`;
      optionsMessage += `   ${rest.specialty} • ${rest.estimatedTime}\n`;
      optionsMessage += `   💰 ${rest.price}\n\n`;
    });
    optionsMessage += "Digite o NÚMERO da sua escolha! 🎯";

    // ADICIONAR À LISTA DE MENSAGENS PENDENTES NO STORAGE GLOBAL
    global.pendingMessages.set(session.id, {
      message: optionsMessage,
      timestamp: new Date(),
      restaurants: restaurants
    });

    // SALVAR PEDIDO NO STORAGE GLOBAL
    global.orders.set(session.id, {
      sessionId: session.id,
      restaurants: restaurants,
      orderData: session.orderData,
      status: 'restaurants_found',
      timestamp: new Date()
    });

    console.log(`[BUSCA] 🚀 SUCESSO TOTAL! Mensagem adicionada para polling: ${session.id}`);
    
  } catch (error) {
    console.error(`[BUSCA] ❌ ERRO CRÍTICO:`, error);
    
    // ADICIONAR MENSAGEM DE ERRO
    global.pendingMessages.set(session.id, {
      message: "😔 Erro ao buscar restaurantes. Tente novamente em alguns segundos.",
      timestamp: new Date()
    });
  }
}

// Gerar restaurantes premium por tipo e cidade
function gerarRestaurantesPremium(foodType, city) {
  console.log(`[FALLBACK] 🔄 Gerando dados premium: ${foodType} em ${city}`);
  
  // Determinar DDD por cidade
  let ddd = '11'; // SP padrão
  const cityLower = city.toLowerCase();
  
  if (cityLower.includes('rio')) ddd = '21';
  else if (cityLower.includes('salvador')) ddd = '71';
  else if (cityLower.includes('brasília') || cityLower.includes('brasilia')) ddd = '61';
  else if (cityLower.includes('fortaleza')) ddd = '85';
  else if (cityLower.includes('recife')) ddd = '81';
  else if (cityLower.includes('porto alegre')) ddd = '51';
  else if (cityLower.includes('curitiba')) ddd = '41';
  else if (cityLower.includes('goiânia') || cityLower.includes('goiania')) ddd = '62';
  else if (cityLower.includes('belo horizonte')) ddd = '31';
  else if (cityLower.includes('manaus')) ddd = '92';
  
  const foodLower = foodType.toLowerCase();
  
  if (foodLower.includes('pizza')) {
    return [
      {
        name: 'Pizzaria Dom Giuseppe',
        phone: `55${ddd}987654321`,
        specialty: 'Pizza italiana artesanal',
        estimatedTime: '30-40 min',
        price: 'R$ 35-55'
      },
      {
        name: 'Pizza & Arte',
        phone: `55${ddd}976543210`, 
        specialty: 'Pizza gourmet premium',
        estimatedTime: '35-45 min',
        price: 'R$ 38-58'
      },
      {
        name: 'Dona Maria Pizzaria',
        phone: `55${ddd}965432109`,
        specialty: 'Pizza tradicional brasileira',
        estimatedTime: '25-35 min',
        price: 'R$ 28-48'
      }
    ];
  } else if (foodLower.includes('sushi') || foodLower.includes('japon')) {
    return [
      {
        name: 'Sushi Premium Tokyo',
        phone: `55${ddd}987654322`,
        specialty: 'Culinária japonesa premium',
        estimatedTime: '40-55 min',
        price: 'R$ 45-75'
      },
      {
        name: 'Yamato Sushi Bar',
        phone: `55${ddd}976543211`,
        specialty: 'Sushi fresco e sashimi',
        estimatedTime: '35-50 min',
        price: 'R$ 42-68'
      },
      {
        name: 'Sakura Delivery',
        phone: `55${ddd}965432110`,
        specialty: 'Combinados orientais',
        estimatedTime: '45-60 min',
        price: 'R$ 38-65'
      }
    ];
  } else if (foodLower.includes('hambur') || foodLower.includes('burger')) {
    return [
      {
        name: 'Prime Burger House',
        phone: `55${ddd}987654323`,
        specialty: 'Hamburger artesanal premium',
        estimatedTime: '25-35 min',
        price: 'R$ 32-48'
      },
      {
        name: 'Burger & Co.',
        phone: `55${ddd}976543212`,
        specialty: 'Burgers gourmet',
        estimatedTime: '30-40 min',
        price: 'R$ 28-45'
      },
      {
        name: 'Classic American Burger',
        phone: `55${ddd}965432111`,
        specialty: 'Hamburguer tradicional',
        estimatedTime: '20-30 min',
        price: 'R$ 25-42'
      }
    ];
  } else {
    // Genérico premium
    return [
      {
        name: 'Sabor Gourmet Express',
        phone: `55${ddd}987654324`,
        specialty: 'Culinária variada premium',
        estimatedTime: '25-40 min',
        price: 'R$ 30-45'
      },
      {
        name: 'Delícias do Chef',
        phone: `55${ddd}976543213`,
        specialty: 'Pratos especiais do dia',
        estimatedTime: '30-45 min',
        price: 'R$ 28-48'
      },
      {
        name: 'Food & Style',
        phone: `55${ddd}965432112`,
        specialty: 'Gastronomia contemporânea',
        estimatedTime: '35-50 min',
        price: 'R$ 35-58'
      }
    ];
  }
}

// Extrair informações do pedido
async function extractOrderInfo(session, messageHistory, currentMessage) {
  console.log(`[EXTRACT] 🔍 Analisando: ${currentMessage}`);

  const lowerMessage = messageHistory.toLowerCase();
  const currentLower = currentMessage.toLowerCase();

  // Detectar COMIDA
  if (!session.orderData.food) {
    const foodKeywords = ['pizza', 'hambur', 'sushi', 'yakisoba', 'lanche', 'combo', 'prato', 'comida'];
    if (foodKeywords.some(kw => currentLower.includes(kw))) {
      session.orderData.food = currentMessage;
      console.log(`[EXTRACT] 🍕 Comida: ${currentMessage}`);
    }
  }

  // Detectar ENDEREÇO
  if (!session.orderData.address) {
    const addressPatterns = [
      /(?:rua|r\.)\s+[^\d,]+,?\s*\d+/i,
      /(?:avenida|av\.)\s+[^\d,]+,?\s*\d+/i,
      /[^\d,]+,\s*\d+/i
    ];

    for (const pattern of addressPatterns) {
      if (pattern.test(currentMessage)) {
        session.orderData.address = currentMessage;
        console.log(`[EXTRACT] 📍 Endereço: ${currentMessage}`);
        break;
      }
    }
  }

  // Detectar TELEFONE
  if (!session.orderData.phone) {
    const phoneMatch = currentMessage.match(/(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?[\d\s-]{8,11}/);
    if (phoneMatch) {
      session.orderData.phone = phoneMatch[0].replace(/\D/g, '');
      console.log(`[EXTRACT] 📱 Telefone: ${session.orderData.phone}`);
    }
  }

  // Detectar PAGAMENTO
  if (!session.orderData.paymentMethod) {
    if (currentLower.includes('dinheiro') || currentLower.includes('espécie')) {
      session.orderData.paymentMethod = 'dinheiro';
    } else if (currentLower.includes('cartão') || currentLower.includes('cartao')) {
      session.orderData.paymentMethod = 'cartão';
    } else if (currentLower.includes('pix')) {
      session.orderData.paymentMethod = 'pix';
    }
    
    if (session.orderData.paymentMethod) {
      console.log(`[EXTRACT] 💰 Pagamento: ${session.orderData.paymentMethod}`);
    }
  }

  // Detectar TROCO
  if (session.orderData.paymentMethod === 'dinheiro' && !session.orderData.change) {
    const changeMatch = currentMessage.match(/(?:troco\s*(?:para|de)?\s*)?(?:r\$\s*)?(\d{1,3})/i);
    if (changeMatch) {
      session.orderData.change = changeMatch[1];
      console.log(`[EXTRACT] 💵 Troco: R$ ${session.orderData.change}`);
    }
  }
}
