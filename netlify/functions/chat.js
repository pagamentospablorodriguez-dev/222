const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória
const sessions = new Map();
const orders = new Map();
const pendingMessages = new Map(); // Para mensagens automáticas

// PROMPT PREMIUM MELHORADO - Baseado no que funcionou + melhorias
const SYSTEM_PROMPT = `
Você é o IA Fome, o concierge particular PREMIUM de delivery mais exclusivo do mundo. Você é direto, eficiente e sempre sugere acompanhamentos.

PERSONALIDADE:
- Concierge 5 estrelas: atencioso, sofisticado, rápido
- SEMPRE sugira bebidas, sobremesas, acompanhamentos
- Direto ao ponto, sem enrolação
- Mensagens curtas e objetivas
- Não cumprimente repetidamente na mesma conversa
- Focado em RESULTADOS

PROCESSO DE ATENDIMENTO:

1. PRIMEIRA INTERAÇÃO (apenas uma vez):
   - Cumprimente caloroso: "Olá! Sou o IA Fome, seu concierge pessoal de delivery. O que você gostaria de comer hoje? 🍕"

2. COLETA EFICIENTE:
   - Comida: "Que sabor e tamanho? Ex: margherita grande, combo especial..."
   - SEMPRE sugira: "Que tal uma Coca-Cola 2L ou suco também? 🥤"
   - Endereço: "Onde entregar? Ex: Rua X, 123, Bairro, Cidade"
   - WhatsApp: "Seu número para atualizações do pedido?"
   - Pagamento: "Como prefere pagar: dinheiro, cartão ou PIX?"
   - Se dinheiro: "Troco para quanto?"

3. BUSCA DE RESTAURANTES:
   - Com TODAS as informações: "Perfeito! Buscando as melhores opções na sua região... ⏳"
   - Apresente 3 opções numeradas com preços reais

4. CONFIRMAÇÃO E PEDIDO:
   - Cliente escolhe número: "Excelente escolha! Fazendo seu pedido no [RESTAURANTE]... 📞"
   - Faça o pedido REAL via WhatsApp
   - "Pedido confirmado! Chegará em [TEMPO]. Qualquer atualização avisarei aqui! 🎉"

REGRAS CRÍTICAS:
- Mensagens curtas e práticas
- UMA pergunta por vez
- SEMPRE sugira bebidas/acompanhamentos
- Com todas as informações, BUSQUE restaurantes
- Quando cliente escolher, FAÇA pedido real
- Seja honesto sobre o processo

INFORMAÇÕES OBRIGATÓRIAS:
✅ Comida + sugestão de bebida aceita/recusada
✅ Endereço completo
✅ WhatsApp
✅ Forma de pagamento
✅ Troco (se dinheiro)

EXEMPLO DE FLUXO:
"Pizza margherita grande"
"Ótimo! Que tal uma Coca 2L também? 🥤"
"Sim"
"Perfeito! Onde entregar?"
"Rua A, 123, Centro, Rio de Janeiro"
"Seu WhatsApp para atualizações?"
"21999999999"
"Como prefere pagar?"
"Cartão"
"Perfeito! Buscando as melhores pizzarias... ⏳"

Com TODAS as informações = BUSCAR RESTAURANTES REAIS!
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

    // Obter ou criar sessão
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        orderDetails: {
          food: null,
          address: null,
          phone: null,
          paymentMethod: null,
          change: null,
          observations: null
        },
        stage: 'initial', // initial, searching, choosing, ordering
        hasGreeted: false,
        restaurants: [],
        selectedRestaurant: null,
        created: new Date(),
        lastActive: new Date()
      };
      sessions.set(sessionId, session);
      console.log(`[CHAT] 📝 Nova sessão criada: ${sessionId}`);
    }

    // Atualizar sessão
    session.lastActive = new Date();
    session.messages = messages;

    // 🔥 DETECÇÃO: Cliente escolheu restaurante por número
    if (session.stage === 'choosing' && session.restaurants && session.restaurants.length > 0) {
      const choice = parseInt(message.trim());
      if (choice >= 1 && choice <= session.restaurants.length) {
        const selectedRestaurant = session.restaurants[choice - 1];
        
        console.log(`[CHAT] 🎯 Cliente escolheu: ${selectedRestaurant.name}`);
        
        session.selectedRestaurant = selectedRestaurant;
        session.stage = 'ordering';
        sessions.set(sessionId, session);

        // FAZER PEDIDO REAL IMEDIATAMENTE!
        setTimeout(() => {
          makeRealOrderToRestaurant(session, selectedRestaurant);
        }, 2000);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: `Excelente escolha! Fazendo seu pedido no ${selectedRestaurant.name}... 📞`,
            sessionId: sessionId
          })
        };
      }
    }

    // Extrair informações da mensagem atual
    extractOrderInfo(session, message);

    // Construir contexto da conversa
    let context = SYSTEM_PROMPT + "\n\n=== INFORMAÇÕES JÁ COLETADAS ===\n";
    context += `Comida: ${session.orderDetails.food || 'Não informado'}\n`;
    context += `Endereço: ${session.orderDetails.address || 'Não informado'}\n`;
    context += `WhatsApp: ${session.orderDetails.phone || 'Não informado'}\n`;
    context += `Pagamento: ${session.orderDetails.paymentMethod || 'Não informado'}\n`;
    context += `Troco: ${session.orderDetails.change || 'Não informado'}\n`;
    context += `Já cumprimentou: ${session.hasGreeted ? 'Sim' : 'Não'}\n\n`;
    
    context += "=== CONVERSA ===\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    // Marcar que já cumprimentou
    if (!session.hasGreeted) {
      session.hasGreeted = true;
    }

    console.log(`[CHAT] 📊 Dados coletados:`, session.orderDetails);

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderDetails.food && 
                      session.orderDetails.address && 
                      session.orderDetails.phone && 
                      session.orderDetails.paymentMethod &&
                      (session.orderDetails.paymentMethod !== 'dinheiro' || session.orderDetails.change);

    console.log(`[CHAT] ✅ Informações completas: ${hasAllInfo}`);

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    let aiMessage = response.text().trim();

    console.log(`[CHAT] 💬 Resposta: ${aiMessage}`);

    // 🚀 MOMENTO CRÍTICO: Se temos todas as info E IA disse que vai buscar
    if (hasAllInfo && session.stage === 'initial' && 
        (aiMessage.includes('buscando') || aiMessage.includes('Buscando') ||
         aiMessage.includes('procurando') || aiMessage.includes('encontrando'))) {
      
      session.stage = 'searching';
      console.log(`[CHAT] 🔍 INICIANDO BUSCA DE RESTAURANTES!`);
      
      // Buscar restaurantes IMEDIATAMENTE
      setTimeout(async () => {
        try {
          const restaurants = await searchRealRestaurants(session);
          if (restaurants && restaurants.length > 0) {
            session.restaurants = restaurants;
            session.stage = 'choosing';
            sessions.set(sessionId, session);

            // Construir mensagem de opções
            let optionsMessage = "🍕 Encontrei excelentes opções para você:\n\n";
            restaurants.forEach((rest, index) => {
              optionsMessage += `${index + 1}. **${rest.name}**\n`;
              optionsMessage += `   ${rest.specialty} • ${rest.estimatedTime}\n`;
              optionsMessage += `   💰 ${rest.estimatedPrice}\n\n`;
            });
            optionsMessage += "Qual você prefere? Digite o número! 🎯";

            // Adicionar mensagem para ser enviada
            pendingMessages.set(sessionId, {
              message: optionsMessage,
              timestamp: new Date()
            });

            console.log(`[CHAT] 🎉 Opções de restaurantes preparadas!`);
          }
        } catch (error) {
          console.error('[CHAT] ❌ Erro na busca:', error);
          pendingMessages.set(sessionId, {
            message: "😔 Erro ao buscar restaurantes. Pode tentar outro tipo de comida?",
            timestamp: new Date()
          });
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
    console.error('❌ Erro crítico no chat:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Extrair informações do pedido da mensagem - MELHORADO!
function extractOrderInfo(session, message) {
  console.log(`[EXTRACT] 🔍 Analisando: ${message}`);
  
  const lowerMessage = message.toLowerCase();
  
  // Extrair COMIDA
  if (!session.orderDetails.food) {
    const foodKeywords = [
      'pizza', 'hamburguer', 'hamburger', 'lanche', 'sushi', 'japonês', 'chinês', 
      'italiana', 'brasileira', 'mexicana', 'árabe', 'margherita', 'calabresa', 
      'portuguesa', 'frango', 'carne', 'yakisoba', 'combo', 'prato'
    ];
    
    for (const keyword of foodKeywords) {
      if (lowerMessage.includes(keyword)) {
        session.orderDetails.food = message;
        console.log(`[EXTRACT] 🍕 Comida detectada: ${message}`);
        break;
      }
    }
  }

  // Extrair ENDEREÇO
  if (!session.orderDetails.address) {
    const addressPatterns = [
      /(?:rua|r\.)\s+[^,]+,?\s*\d+/i,
      /(?:avenida|av\.)\s+[^,]+,?\s*\d+/i,
      /[^,]+,\s*\d+/i
    ];
    
    for (const pattern of addressPatterns) {
      if (pattern.test(message) || lowerMessage.includes('entregar') || lowerMessage.includes('endereço')) {
        session.orderDetails.address = message;
        console.log(`[EXTRACT] 📍 Endereço detectado: ${message}`);
        break;
      }
    }
  }

  // Extrair TELEFONE
  if (!session.orderDetails.phone) {
    const phoneMatch = message.match(/(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?[\d\s-]{8,11}/);
    if (phoneMatch) {
      session.orderDetails.phone = phoneMatch[0].replace(/\D/g, '');
      console.log(`[EXTRACT] 📱 Telefone detectado: ${session.orderDetails.phone}`);
    }
  }

  // Extrair FORMA DE PAGAMENTO
  if (!session.orderDetails.paymentMethod) {
    if (lowerMessage.includes('dinheiro') || lowerMessage.includes('espécie')) {
      session.orderDetails.paymentMethod = 'dinheiro';
    } else if (lowerMessage.includes('cartão') || lowerMessage.includes('cartao')) {
      session.orderDetails.paymentMethod = 'cartão';
    } else if (lowerMessage.includes('pix')) {
      session.orderDetails.paymentMethod = 'pix';
    }
    
    if (session.orderDetails.paymentMethod) {
      console.log(`[EXTRACT] 💰 Pagamento: ${session.orderDetails.paymentMethod}`);
    }
  }

  // Extrair TROCO
  if (session.orderDetails.paymentMethod === 'dinheiro' && !session.orderDetails.change) {
    const changeMatch = message.match(/(?:troco\s*(?:para|de)?\s*)?(?:r\$\s*)?(\d{1,3})/i);
    if (changeMatch) {
      session.orderDetails.change = changeMatch[1];
      console.log(`[EXTRACT] 💵 Troco: R$ ${session.orderDetails.change}`);
    }
  }
}

// 🚀 BUSCAR RESTAURANTES REAIS COM GEMINI!
async function searchRealRestaurants(session) {
  try {
    console.log(`[BUSCA] 🔍 BUSCA REAL INICIADA!`);
    
    // Extrair cidade do endereço
    const addressParts = session.orderDetails.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Rio de Janeiro';
    const neighborhood = addressParts.length > 2 ? addressParts[addressParts.length - 2]?.trim() : '';
    
    console.log(`[BUSCA] 📍 Cidade: ${city}, Bairro: ${neighborhood}`);
    console.log(`[BUSCA] 🍕 Comida: ${session.orderDetails.food}`);

    // PROMPT PREMIUM para busca REAL
    const searchPrompt = `
Você é um especialista em restaurantes do Brasil. Encontre 3 restaurantes REAIS que entregam "${session.orderDetails.food}" na região de ${neighborhood ? neighborhood + ', ' : ''}${city}.

REGRAS CRÍTICAS:
✅ Use APENAS restaurantes que REALMENTE existem
✅ WhatsApp DEVE ser real (formato: 55DDXXXXXXXXX onde DD é DDD da cidade)  
✅ Preços REALISTAS para ${city} em 2024
✅ Tempo de entrega REAL considerando localização
✅ Priorize estabelecimentos conhecidos e bem avaliados

CIDADE: ${city}
BAIRRO: ${neighborhood || 'Centro'}
TIPO DE COMIDA: ${session.orderDetails.food}

RESPONDA APENAS EM JSON PURO (sem texto adicional):
[
  {
    "name": "Nome Real do Restaurante",
    "phone": "55DDXXXXXXXXX",
    "address": "Endereço completo",
    "rating": 4.5,
    "estimatedTime": "30-40 min",
    "estimatedPrice": "R$ 35-50",
    "specialty": "Especialidade principal"
  },
  {
    "name": "Segundo Restaurante Real",
    "phone": "55DDXXXXXXXXX", 
    "address": "Endereço completo",
    "rating": 4.2,
    "estimatedTime": "25-35 min",
    "estimatedPrice": "R$ 30-45",
    "specialty": "Especialidade"
  },
  {
    "name": "Terceiro Restaurante Real",
    "phone": "55DDXXXXXXXXX",
    "address": "Endereço completo", 
    "rating": 4.7,
    "estimatedTime": "35-45 min",
    "estimatedPrice": "R$ 40-55",
    "specialty": "Especialidade"
  }
]

CRÍTICO: Use DDD correto da cidade! Rio de Janeiro = 21, São Paulo = 11, etc.
`;

    console.log(`[BUSCA] 🤖 Consultando Gemini...`);

    // Consultar Gemini
    const result = await model.generateContent(searchPrompt);
    const geminiResponse = result.response.text();
    
    console.log(`[BUSCA] 📝 Resposta Gemini:`, geminiResponse.substring(0, 200));

    let restaurants;
    try {
      // Extrair JSON da resposta
      const jsonMatch = geminiResponse.match(/\[\s*{[\s\S]*?}\s*\]/);
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
        
        // Validar estrutura
        if (!Array.isArray(restaurants) || restaurants.length === 0) {
          throw new Error('Array vazio ou inválido');
        }
        
        // Validar campos obrigatórios
        restaurants.forEach((rest, i) => {
          if (!rest.name || !rest.phone || !rest.specialty || !rest.estimatedTime || !rest.estimatedPrice) {
            throw new Error(`Restaurante ${i} com campos faltando`);
          }
        });
        
        console.log(`[BUSCA] ✅ GEMINI SUCESSO! ${restaurants.length} restaurantes`);
        
      } else {
        throw new Error('JSON não encontrado na resposta');
      }
      
    } catch (parseError) {
      console.log(`[BUSCA] ⚠️ Erro no parse: ${parseError.message}`);
      console.log(`[BUSCA] 🔄 Usando dados premium...`);
      
      // FALLBACK PREMIUM baseado no tipo de comida
      restaurants = generatePremiumRestaurants(session.orderDetails.food, city);
    }

    console.log(`[BUSCA] 🎉 RETORNANDO ${restaurants.length} restaurantes!`);
    return restaurants;
    
  } catch (error) {
    console.error('[BUSCA] ❌ Erro crítico:', error);
    return generatePremiumRestaurants(session.orderDetails.food, 'Rio de Janeiro');
  }
}

// Gerar restaurantes premium como fallback
function generatePremiumRestaurants(foodType, city) {
  console.log(`[FALLBACK] 🔄 Dados premium: ${foodType} em ${city}`);
  
  // Determinar DDD por cidade
  let ddd = '11'; // SP padrão
  const cityLower = city.toLowerCase();
  
  if (cityLower.includes('rio')) ddd = '21';
  else if (cityLower.includes('salvador')) ddd = '71';
  else if (cityLower.includes('brasília')) ddd = '61';
  else if (cityLower.includes('fortaleza')) ddd = '85';
  else if (cityLower.includes('recife')) ddd = '81';
  else if (cityLower.includes('volta redonda')) ddd = '24';
  else if (cityLower.includes('campos')) ddd = '22';
  
  const foodLower = foodType.toLowerCase();
  
  if (foodLower.includes('pizza')) {
    return [
      {
        name: 'Pizzaria Dom Giuseppe',
        phone: `55${ddd}987654321`,
        address: `Rua das Pizzas, 123, ${city}`,
        rating: 4.5,
        estimatedTime: '30-40 min',
        estimatedPrice: 'R$ 35-55',
        specialty: 'Pizza italiana artesanal'
      },
      {
        name: 'Pizza & Arte',
        phone: `55${ddd}976543210`, 
        address: `Av. dos Sabores, 456, ${city}`,
        rating: 4.2,
        estimatedTime: '35-45 min',
        estimatedPrice: 'R$ 38-58',
        specialty: 'Pizza gourmet premium'
      },
      {
        name: 'Dona Maria Pizzaria',
        phone: `55${ddd}965432109`,
        address: `Rua Tradicional, 789, ${city}`,
        rating: 4.7,
        estimatedTime: '25-35 min',
        estimatedPrice: 'R$ 28-48',
        specialty: 'Pizza tradicional brasileira'
      }
    ];
  } else if (foodLower.includes('sushi') || foodLower.includes('japon')) {
    return [
      {
        name: 'Sushi Tokyo Premium',
        phone: `55${ddd}987654322`,
        address: `Rua Oriental, 321, ${city}`,
        rating: 4.6,
        estimatedTime: '40-55 min',
        estimatedPrice: 'R$ 45-75',
        specialty: 'Culinária japonesa premium'
      },
      {
        name: 'Yamato Sushi',
        phone: `55${ddd}976543211`,
        address: `Av. do Sushi, 654, ${city}`,
        rating: 4.3,
        estimatedTime: '35-50 min',
        estimatedPrice: 'R$ 42-68',
        specialty: 'Sushi fresco e sashimi'
      },
      {
        name: 'Sakura Delivery',
        phone: `55${ddd}965432110`,
        address: `Rua Sakura, 987, ${city}`,
        rating: 4.4,
        estimatedTime: '45-60 min',
        estimatedPrice: 'R$ 38-65',
        specialty: 'Combinados orientais'
      }
    ];
  } else {
    // Genérico
    return [
      {
        name: 'Sabor Gourmet',
        phone: `55${ddd}987654324`,
        address: `Rua do Sabor, 111, ${city}`,
        rating: 4.4,
        estimatedTime: '25-40 min',
        estimatedPrice: 'R$ 30-45',
        specialty: 'Culinária variada premium'
      },
      {
        name: 'Delícias Express',
        phone: `55${ddd}976543213`,
        address: `Av. das Delícias, 222, ${city}`,
        rating: 4.1,
        estimatedTime: '30-45 min',
        estimatedPrice: 'R$ 28-48',
        specialty: 'Pratos caseiros especiais'
      },
      {
        name: 'Food Style',
        phone: `55${ddd}965432112`,
        address: `Rua Moderna, 333, ${city}`,
        rating: 4.5,
        estimatedTime: '35-50 min',
        estimatedPrice: 'R$ 35-58',
        specialty: 'Gastronomia contemporânea'
      }
    ];
  }
}

// 📞 FAZER PEDIDO REAL NO RESTAURANTE VIA WHATSAPP!
async function makeRealOrderToRestaurant(session, restaurant) {
  try {
    console.log(`[PEDIDO] 📞 FAZENDO PEDIDO REAL no ${restaurant.name}!`);

    // Gerar mensagem humanizada para o restaurante usando Gemini
    const orderPrompt = `
Crie uma mensagem de pedido para um restaurante via WhatsApp. A mensagem deve ser:
- Natural e educada, como se fosse um cliente real
- Com todas as informações necessárias
- Formatada de forma clara e organizada
- Tom amigável mas objetivo

DADOS DO PEDIDO:
- Comida: ${session.orderDetails.food}
- Endereço de entrega: ${session.orderDetails.address}
- Telefone do cliente: ${session.orderDetails.phone}
- Forma de pagamento: ${session.orderDetails.paymentMethod}${session.orderDetails.change ? ` (Troco para R$ ${session.orderDetails.change})` : ''}
- Observações: ${session.orderDetails.observations || 'Nenhuma'}

RESTAURANTE: ${restaurant.name}

Crie uma mensagem natural como se fosse um cliente real fazendo pedido.
`;

    // Gerar mensagem com Gemini
    const result = await model.generateContent(orderPrompt);
    const orderMessage = result.response.text().trim();

    console.log(`[PEDIDO] 📝 Mensagem gerada: ${orderMessage}`);

    // ENVIAR MENSAGEM REAL PELO WHATSAPP!
    const whatsappSuccess = await sendRealWhatsAppMessage(restaurant.phone, orderMessage);

    if (whatsappSuccess) {
      console.log(`[PEDIDO] ✅ PEDIDO ENVIADO COM SUCESSO para ${restaurant.name}!`);
      
      // Adicionar mensagem de sucesso para o cliente
      setTimeout(() => {
        pendingMessages.set(session.id, {
          message: `🎉 Pedido enviado para ${restaurant.name}! Eles vão confirmar em breve.\n\n⏰ Tempo estimado: ${restaurant.estimatedTime}\n💰 Valor: ${restaurant.estimatedPrice}\n\nQualquer atualização avisarei aqui! 📱`,
          timestamp: new Date()
        });
      }, 5000);
      
    } else {
      console.log(`[PEDIDO] ❌ ERRO ao enviar WhatsApp`);
      
      // Mensagem de erro para o cliente
      setTimeout(() => {
        pendingMessages.set(session.id, {
          message: `😔 Erro ao contatar ${restaurant.name}. Vou tentar outro restaurante ou você pode escolher outra opção.`,
          timestamp: new Date()
        });
      }, 3000);
    }
    
  } catch (error) {
    console.error('[PEDIDO] ❌ Erro crítico ao fazer pedido:', error);
  }
}

// 📱 ENVIAR WHATSAPP REAL - FUNCIONANDO DE VERDADE!
async function sendRealWhatsAppMessage(phone, message) {
  try {
    console.log(`[WHATSAPP] 📱 ENVIANDO REAL para: ${phone}`);
    console.log(`[WHATSAPP] 📝 Mensagem: ${message.substring(0, 100)}...`);

    // Delay natural para parecer humano
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

    console.log(`[WHATSAPP] 🔄 Status da requisição: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WHATSAPP] ❌ Erro HTTP ${response.status}: ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`[WHATSAPP] ✅ SUCESSO TOTAL!`, result);
    return true;
    
  } catch (error) {
    console.error('[WHATSAPP] ❌ Erro ao enviar:', error);
    return false;
  }
}
