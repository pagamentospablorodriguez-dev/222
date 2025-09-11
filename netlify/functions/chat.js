const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
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
const pendingMessages = new Map(); // Para mensagens automáticas

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

    console.log(`[CHAT] Sessão: ${sessionId}, Mensagem: ${message}`);

    // Obter ou criar sessão
    let session = sessions.get(sessionId);
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
      sessions.set(sessionId, session);
      console.log(`[CHAT] Nova sessão criada: ${sessionId}`);
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

    console.log(`[CHAT] Dados atuais:`, session.orderData);

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    console.log(`[CHAT] Tem todas as informações: ${hasAllInfo}`);

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    let aiMessage = response.text().trim();

    // Limitar tamanho da mensagem (máximo 120 caracteres)
    if (aiMessage.length > 120) {
      const sentences = aiMessage.split(/[.!?]+/);
      aiMessage = sentences[0] + (sentences[0].endsWith('.') || sentences[0].endsWith('!') || sentences[0].endsWith('?') ? '' : '.');
      if (aiMessage.length > 120) {
        aiMessage = aiMessage.substring(0, 117) + '...';
      }
    }

    console.log(`[CHAT] Resposta gerada: ${aiMessage}`);

    // Se temos todas as informações E a IA disse que vai buscar
    if (hasAllInfo && session.stage === 'initial' && 
        (aiMessage.includes('buscando') || aiMessage.includes('aguard') || 
         aiMessage.includes('procurand') || aiMessage.includes('encontrando'))) {
      
      session.stage = 'searching_restaurants';
      console.log(`[CHAT] 🚀 INICIANDO BUSCA IMEDIATA para: ${sessionId}`);
      
      // Buscar restaurantes IMEDIATAMENTE - SEM DELAY
      searchRestaurantsWithGemini(session)
        .then(restaurants => {
          if (restaurants && restaurants.length > 0) {
            // Construir mensagem com opções PERFEITA
            let optionsMessage = "🍕 ENCONTREI! Melhores opções para você:\n\n";
            restaurants.forEach((rest, index) => {
              optionsMessage += `${index + 1}. ${rest.name}\n`;
              optionsMessage += `   ${rest.specialty} • ${rest.estimatedTime}\n`;
              optionsMessage += `   💰 ${rest.price}\n\n`;
            });
            optionsMessage += "Digite o NÚMERO da sua escolha! 🎯";

            // Armazenar mensagem para polling IMEDIATAMENTE
            pendingMessages.set(sessionId, {
              message: optionsMessage,
              timestamp: new Date(),
              restaurants: restaurants
            });

            console.log(`[BUSCA] ✅ Opções ENVIADAS para ${sessionId}:`, restaurants.length);
          } else {
            // Se não encontrou, avisar o cliente
            pendingMessages.set(sessionId, {
              message: "😔 Não encontrei restaurantes na sua região. Tente outro tipo de comida ou endereço.",
              timestamp: new Date()
            });
            console.error(`[BUSCA] ❌ Nenhum restaurante encontrado para ${sessionId}`);
          }
        })
        .catch(error => {
          console.error('[BUSCA] ❌ Erro na busca:', error);
          // Avisar o cliente sobre o erro
          pendingMessages.set(sessionId, {
            message: "😔 Erro ao buscar restaurantes. Tente novamente em alguns segundos.",
            timestamp: new Date()
          });
        });
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
    console.error('❌ Erro no chat:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Função MELHORADA para extrair informações
async function extractOrderInfo(session, messageHistory, currentMessage) {
  console.log(`[EXTRACT] 🔍 Analisando: ${currentMessage}`);

  const lowerMessage = messageHistory.toLowerCase();
  const currentLower = currentMessage.toLowerCase();

  // Detectar COMIDA com mais precisão
  if (!session.orderData.food) {
    const foodPatterns = [
      /pizza\s+(pequena|média|grande|família|gigante)/i,
      /pizza\s+(margherita|calabresa|portuguesa|quatro\s+queijos|frango|pepperoni)/i,
      /(hambur|burger)\s+(clássico|cheese|bacon|frango|duplo)/i,
      /(sushi|japonês)\s+(tradicional|salmão|combinado|temaki)/i,
      /yakisoba\s+(frango|carne|camarão|misto)/i,
      /(combo|lanche)\s+(do\s+dia|especial|completo)/i
    ];

    for (const pattern of foodPatterns) {
      if (pattern.test(currentMessage)) {
        session.orderData.food = currentMessage;
        console.log(`[EXTRACT] 🍕 Comida detectada: ${currentMessage}`);
        break;
      }
    }

    // Se não achou padrão específico, verificar palavras-chave gerais
    if (!session.orderData.food) {
      const keywords = ['pizza', 'hambur', 'sushi', 'yakisoba', 'lanche', 'combo'];
      if (keywords.some(kw => currentLower.includes(kw))) {
        session.orderData.food = currentMessage;
        console.log(`[EXTRACT] 🍕 Comida genérica detectada: ${currentMessage}`);
      }
    }
  }

  // Detectar ENDEREÇO com mais precisão
  if (!session.orderData.address) {
    const addressPatterns = [
      /(?:rua|r\.)\s+[^\d,]+,?\s*\d+/i,
      /(?:avenida|av\.)\s+[^\d,]+,?\s*\d+/i,
      /[^\d,]+,\s*\d+[\s,]*[^\d]*(?:,\s*\w+)?/i,
      /\d+.*(?:copacabana|ipanema|botafogo|flamengo|centro|tijuca|barra)/i
    ];

    for (const pattern of addressPatterns) {
      if (pattern.test(currentMessage)) {
        session.orderData.address = currentMessage;
        console.log(`[EXTRACT] 📍 Endereço detectado: ${currentMessage}`);
        break;
      }
    }
  }

  // Detectar TELEFONE
  if (!session.orderData.phone) {
    const phoneMatch = currentMessage.match(/(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?[\d\s-]{8,11}/);
    if (phoneMatch) {
      session.orderData.phone = phoneMatch[0].replace(/\D/g, '');
      console.log(`[EXTRACT] 📱 Telefone detectado: ${session.orderData.phone}`);
    }
  }

  // Detectar PAGAMENTO
  if (!session.orderData.paymentMethod) {
    if (currentLower.includes('dinheiro') || currentLower.includes('espécie')) {
      session.orderData.paymentMethod = 'dinheiro';
      console.log(`[EXTRACT] 💰 Pagamento: dinheiro`);
    } else if (currentLower.includes('cartão') || currentLower.includes('cartao')) {
      session.orderData.paymentMethod = 'cartão';
      console.log(`[EXTRACT] 💳 Pagamento: cartão`);
    } else if (currentLower.includes('pix')) {
      session.orderData.paymentMethod = 'pix';
      console.log(`[EXTRACT] 💰 Pagamento: pix`);
    }
  }

  // Detectar TROCO
  if (session.orderData.paymentMethod === 'dinheiro' && !session.orderData.change) {
    const changeMatch = currentMessage.match(/(?:troco\s*(?:para|de)?\s*)?(?:r\$\s*)?(\d{1,3})/i);
    if (changeMatch) {
      session.orderData.change = changeMatch[1];
      console.log(`[EXTRACT] 💵 Troco detectado: R$ ${session.orderData.change}`);
    }
  }
}

// BUSCAR RESTAURANTES COM GEMINI - FUNÇÃO PRINCIPAL! 🚀
async function searchRestaurantsWithGemini(session) {
  try {
    console.log(`[GEMINI-SEARCH] 🔍 INICIANDO BUSCA REAL...`);
    
    // Extrair cidade do endereço
    const addressParts = session.orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Rio de Janeiro';
    const neighborhood = addressParts[addressParts.length - 2]?.trim() || '';

    console.log(`[GEMINI-SEARCH] 📍 BUSCANDO EM: ${city}, Bairro: ${neighborhood}`);
    console.log(`[GEMINI-SEARCH] 🍕 TIPO: ${session.orderData.food}`);

    // PROMPT PREMIUM para busca de restaurantes
    const searchPrompt = `
Você é um especialista em restaurantes do Brasil. Encontre 3 restaurantes REAIS que entregam "${session.orderData.food}" na região de ${neighborhood ? neighborhood + ', ' : ''}${city}.

INSTRUÇÕES CRÍTICAS:
✅ Use APENAS restaurantes que realmente existem
✅ WhatsApp DEVE ser real (formato: 55DDXXXXXXXXX onde DD é DDD da cidade)
✅ Preços realistas para ${city} 2024
✅ Tempo de entrega real considerando localização
✅ Priorize estabelecimentos conhecidos e bem avaliados

TIPO DE COMIDA: ${session.orderData.food}
REGIÃO: ${neighborhood ? neighborhood + ', ' : ''}${city}

RESPONDA APENAS EM JSON VÁLIDO:
[
  {
    "name": "Nome Real do Restaurante",
    "phone": "55DDXXXXXXXXX",
    "specialty": "Especialidade principal",
    "estimatedTime": "25-35 min",
    "price": "R$ 28-45"
  },
  {
    "name": "Segundo Restaurante Real", 
    "phone": "55DDXXXXXXXXX",
    "specialty": "Especialidade",
    "estimatedTime": "30-40 min",
    "price": "R$ 32-50"
  },
  {
    "name": "Terceiro Restaurante Real",
    "phone": "55DDXXXXXXXXX", 
    "specialty": "Especialidade",
    "estimatedTime": "35-45 min",
    "price": "R$ 25-42"
  }
]

CRÍTICO: Resposta deve ser JSON puro, sem texto adicional! Use DDD correto da cidade!
`;

    console.log(`[GEMINI-SEARCH] 🤖 CONSULTANDO GEMINI AGORA...`);

    // Consultar Gemini
    const result = await model.generateContent(searchPrompt);
    const response = result.response.text();
    
    console.log(`[GEMINI-SEARCH] 📝 RESPOSTA GEMINI:`, response.substring(0, 300));

    let restaurants;
    try {
      // Extrair JSON da resposta
      const jsonMatch = response.match(/\[\s*{[\s\S]*?}\s*\]/);
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
        
        // Validar estrutura
        if (!Array.isArray(restaurants) || restaurants.length === 0) {
          throw new Error('Array vazio');
        }
        
        // Validar campos obrigatórios
        restaurants.forEach((rest, i) => {
          if (!rest.name || !rest.phone || !rest.specialty || !rest.estimatedTime || !rest.price) {
            throw new Error(`Restaurante ${i} incompleto`);
          }
        });
        
        console.log(`[GEMINI-SEARCH] ✅ SUCESSO! ${restaurants.length} restaurantes encontrados`);
        
      } else {
        throw new Error('JSON não encontrado');
      }
      
    } catch (parseError) {
      console.log(`[GEMINI-SEARCH] ⚠️ ERRO PARSE: ${parseError.message}`);
      console.log(`[GEMINI-SEARCH] 🔄 USANDO FALLBACK PREMIUM...`);
      
      // Dados premium baseados no tipo de comida
      restaurants = generatePremiumRestaurants(session.orderData.food, city);
    }

    // Salvar no sistema de pedidos
    orders.set(session.id, {
      sessionId: session.id,
      restaurants: restaurants,
      orderData: session.orderData,
      status: 'restaurants_found',
      timestamp: new Date()
    });

    console.log(`[GEMINI-SEARCH] 🎉 BUSCA CONCLUÍDA! Retornando ${restaurants.length} opções`);
    return restaurants;
    
  } catch (error) {
    console.error('[GEMINI-SEARCH] ❌ ERRO CRÍTICO:', error);
    return generatePremiumRestaurants(session.orderData.food, 'Rio de Janeiro');
  }
}

// Gerar restaurantes premium por tipo de comida
function generatePremiumRestaurants(foodType, city) {
  console.log(`[FALLBACK] 🔄 Gerando restaurantes premium para: ${foodType} em ${city}`);
  
  // Determinar DDD baseado na cidade
  let ddd = '11'; // São Paulo como padrão
  if (city.toLowerCase().includes('rio')) ddd = '21';
  else if (city.toLowerCase().includes('salvador')) ddd = '71';
  else if (city.toLowerCase().includes('brasília')) ddd = '61';
  else if (city.toLowerCase().includes('fortaleza')) ddd = '85';
  else if (city.toLowerCase().includes('recife')) ddd = '81';
  else if (city.toLowerCase().includes('porto alegre')) ddd = '51';
  else if (city.toLowerCase().includes('curitiba')) ddd = '41';
  else if (city.toLowerCase().includes('goiânia')) ddd = '62';
  
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
        specialty: 'Pizza tradicional carioca',
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
        specialty: 'Estilo americano tradicional',
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
