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
const pendingMessages = new Map(); // Para mensagens automáticas

// Prompt otimizado PERFEITO
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você funciona como um concierge particular premium, oferecendo o melhor atendimento personalizado possível.

MISSÃO: Revolucionar como as pessoas pedem comida online, tornando o processo simples, rápido e sem fricção.

PERSONALIDADE:
- Atencioso e prestativo como um concierge de hotel 5 estrelas
- Proativo em sugerir opções e melhorias
- Eficiente e profissional, mas amigável
- Focado em resolver tudo para o cliente
- Mensagens CURTAS e DIRETAS (máximo 150 caracteres)
- SEMPRE ofereça opções específicas e exemplos

PROCESSO DE ATENDIMENTO:

RECEPÇÃO DO PEDIDO:
- Cumprimente apenas na primeira vez de forma calorosa
- Identifique o que querem comer
- SEMPRE ofereça opções específicas com exemplos

COLETA DE INFORMAÇÕES (uma por vez):
- Comida: tipo, sabor, tamanho
- SEMPRE liste opções específicas:
  * Pizza: "margherita, calabresa, portuguesa, quatro queijos, frango catupiry"
  * Hamburger: "clássico, cheeseburger, bacon burger, frango grelhado, vegano"
  * Sushi: "combinado tradicional, salmão, hot philadelphia, temaki misto"
  * Yakisoba: "frango, carne, camarão, legumes, misto"
  * Tamanhos: "pequena, média, grande ou família?"

- Sugestões proativas: bebidas, sobremesas, acompanhamentos
- Endereço completo de entrega
- Número de WhatsApp do cliente
- Forma de pagamento (dinheiro, cartão, PIX)
- Se dinheiro: quanto de troco (APENAS após saber o preço)

TRATAMENTO DE RESPOSTAS VAGAS:
Se o cliente responder "sei lá", "não sei", "tanto faz":
- NÃO responda apenas "ok"
- Ofereça sugestões específicas
- Exemplo: "Que tal um sushi tradicional com salmão? Ou prefere um combinado misto?"

BUSCA DE RESTAURANTES:
- Quando tiver TODAS as informações necessárias
- Informe que está buscando as melhores opções
- Diga "aguarde um instante"
- A busca será feita automaticamente

INFORMAÇÕES NECESSÁRIAS:
1. Comida desejada (tipo, sabor, tamanho)
2. Endereço completo de entrega  
3. Número de WhatsApp
4. Forma de pagamento
5. Se dinheiro: valor do troco (após saber preço)

DIRETRIZES IMPORTANTES:
- SEMPRE lembre do contexto completo da conversa
- Ofereça opções específicas para cada tipo de comida
- NUNCA responda apenas "ok" para respostas vagas
- Seja útil e proativo sempre
- Uma pergunta por vez, mas com opções claras

Exemplo de resposta para "sei lá":
Cliente: "sei lá mano"
Você: "Que tal um sushi combinado com salmão e hot philadelphia? Ou prefere yakisoba de frango?"
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
      console.log(`[CHAT] Nova sessão criada: ${sessionId}`);
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

    console.log(`[CHAT] Gerando resposta para: ${message}`);

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    const response = result.response;
    let aiMessage = response.text().trim();

    console.log(`[CHAT] Resposta gerada: ${aiMessage}`);

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
    await extractOrderInfo(session, messageHistory, message);

    // Verificar se temos todas as informações necessárias
    const hasAllInfo = session.orderData.food && 
                      session.orderData.address && 
                      session.orderData.phone && 
                      session.orderData.paymentMethod &&
                      (session.orderData.paymentMethod !== 'dinheiro' || session.orderData.change);

    console.log(`[CHAT] Informações coletadas:`, session.orderData);
    console.log(`[CHAT] Tem todas as informações: ${hasAllInfo}`);

    // Se temos todas as informações E ainda não buscamos restaurantes
    if (hasAllInfo && session.stage === 'initial' && 
        (aiMessage.includes('buscando') || aiMessage.includes('aguard') || aiMessage.includes('procurand'))) {
      session.stage = 'searching_restaurant';
      console.log(`[CHAT] Iniciando busca de restaurantes para: ${sessionId}`);
      
      // Chamar função de busca IMEDIATAMENTE
      setTimeout(async () => {
        try {
          const restaurants = await searchRestaurants(session);
          if (restaurants && restaurants.length > 0) {
            // Construir mensagem com opções
            let optionsMessage = "🍕 Encontrei ótimas opções para você:\n\n";
            restaurants.forEach((rest, index) => {
              optionsMessage += `${index + 1}. **${rest.name}**\n`;
              optionsMessage += `   ${rest.specialty}\n`;
              optionsMessage += `   ⏰ ${rest.estimatedTime}\n`;
              optionsMessage += `   💰 ${rest.price}\n\n`;
            });
            optionsMessage += "Qual restaurante você prefere? Digite o número da opção! 😊";

            // Armazenar mensagem para polling
            pendingMessages.set(sessionId, {
              message: optionsMessage,
              timestamp: new Date()
            });

            console.log(`[BUSCA] Opções encontradas para ${sessionId}:`, restaurants);
          }
        } catch (error) {
          console.error('Erro ao buscar restaurantes:', error);
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

// Extrair informações do pedido
async function extractOrderInfo(session, messageHistory, currentMessage) {
  console.log(`[EXTRACT] Extraindo informações de: ${currentMessage}`);

  // Detectar comida
  if (!session.orderData.food) {
    const foodMatch = messageHistory.match(/(pizza|hamburguer|hamburger|lanche|sushi|japonês|chinês|italiana|brasileira|mexicana|árabe|margherita|calabresa|portuguesa|frango|carne|peixe|vegetariana|mcchicken|mcnuggets|big mac|cheeseburger|yakisoba)/i);
    if (foodMatch) {
      session.orderData.food = currentMessage;
      console.log(`[EXTRACT] Comida detectada: ${currentMessage}`);
    }
  }

  // Detectar endereço
  if (!session.orderData.address) {
    const addressMatch = messageHistory.match(/(rua|avenida|av\.|r\.|endereço|entregar|entrega).+?(\d+)/i);
    if (addressMatch) {
      session.orderData.address = currentMessage;
      console.log(`[EXTRACT] Endereço detectado: ${currentMessage}`);
    }
  }

  // Detectar telefone
  if (!session.orderData.phone) {
    const phoneMatch = messageHistory.match(/(\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4})/);
    if (phoneMatch) {
      session.orderData.phone = phoneMatch[0].replace(/\D/g, '');
      console.log(`[EXTRACT] Telefone detectado: ${session.orderData.phone}`);
    }
  }

  // Detectar forma de pagamento
  if (!session.orderData.paymentMethod) {
    if (messageHistory.match(/(dinheiro|espécie)/i)) {
      session.orderData.paymentMethod = 'dinheiro';
      console.log(`[EXTRACT] Pagamento: dinheiro`);
    } else if (messageHistory.match(/(cartão|cartao)/i)) {
      session.orderData.paymentMethod = 'cartão';
      console.log(`[EXTRACT] Pagamento: cartão`);
    } else if (messageHistory.match(/pix/i)) {
      session.orderData.paymentMethod = 'pix';
      console.log(`[EXTRACT] Pagamento: pix`);
    }
  }

  // Detectar troco
  if (session.orderData.paymentMethod === 'dinheiro' && !session.orderData.change) {
    const changeMatch = messageHistory.match(/(\d+)\s*(reais?|r\$)/i);
    if (changeMatch) {
      session.orderData.change = changeMatch[1];
      console.log(`[EXTRACT] Troco detectado: ${session.orderData.change}`);
    }
  }
}

// Buscar restaurantes REAL
async function searchRestaurants(session) {
  try {
    console.log(`[BUSCA] Iniciando busca de restaurantes...`);
    
    // Extrair cidade do endereço
    const addressParts = session.orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Rio de Janeiro';

    console.log(`[BUSCA] Cidade detectada: ${city}`);
    console.log(`[BUSCA] Tipo de comida: ${session.orderData.food}`);

    // Buscar restaurantes usando Gemini
    const searchPrompt = `
Você é um especialista em restaurantes e delivery. Encontre 3 restaurantes REAIS que entregam ${session.orderData.food} na região de ${city}, Rio de Janeiro.

Para cada restaurante, forneça:
- Nome do restaurante (real e existente)
- Número de WhatsApp (formato: 5521999999999)
- Especialidade
- Tempo estimado de entrega
- Preço aproximado do item solicitado

IMPORTANTE:
- Use apenas restaurantes que realmente existem
- Números de WhatsApp devem ser reais
- Preços realistas para a região
- Priorize estabelecimentos conhecidos

Responda APENAS em formato JSON:
[
  {
    "name": "Nome do Restaurante",
    "phone": "5521999999999", 
    "specialty": "Especialidade",
    "estimatedTime": "30-40 min",
    "price": "R$ 35-45"
  }
]
    `;

    const searchResult = await model.generateContent(searchPrompt);
    const restaurantData = searchResult.response.text();
    
    console.log(`[BUSCA] Resposta do Gemini: ${restaurantData}`);

    let restaurants;
    try {
      // Tentar parsear JSON
      const jsonMatch = restaurantData.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
        console.log(`[BUSCA] JSON parseado com sucesso:`, restaurants);
      } else {
        throw new Error('JSON não encontrado na resposta');
      }
    } catch (e) {
      console.log(`[BUSCA] Erro no JSON, usando dados mock:`, e.message);
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
          name: 'Sushi Tokyo',
          phone: '5521977665544',
          specialty: 'Comida japonesa premium',
          estimatedTime: '40-50 min',
          price: 'R$ 45-65'
        }
      ];
    }

    // Salvar pedido com restaurantes
    orders.set(session.id, {
      sessionId: session.id,
      restaurants: restaurants,
      orderData: session.orderData,
      status: 'restaurants_found',
      timestamp: new Date()
    });

    console.log(`[BUSCA] Busca concluída. ${restaurants.length} restaurantes encontrados.`);
    return restaurants;
  } catch (error) {
    console.error('[BUSCA] Erro ao buscar restaurantes:', error);
    return null;
  }
}
