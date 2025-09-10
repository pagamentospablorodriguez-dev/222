const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações
const GEMINI_API_KEY = 'AIzaSyCiFWTVnWzv3B4pbIVijHeRuy1sof1vikg';
const EVOLUTION_BASE_URL = 'https://api.evoapicloud.com';
const EVOLUTION_TOKEN = 'E9BC21E3183D-4119-8D35-AF0DB0B5891E';
const EVOLUTION_INSTANCE_ID = 'ff3a8b42-ba3b-4e1a-99c3-f85b25169070';

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Armazenamento em memória (em produção, usar banco de dados)
const sessions = new Map();
const orders = new Map();

// Prompt do sistema para o IA Fome
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você funciona como um concierge particular premium, oferecendo o melhor atendimento personalizado possível.

MISSÃO: Revolucionar como as pessoas pedem comida online, tornando o processo simples, rápido e sem fricção.

PERSONALIDADE:
- Atencioso e prestativo como um concierge de hotel 5 estrelas
- Proativo em sugerir opções e melhorias
- Eficiente e profissional, mas amigável
- Focado em resolver tudo para o cliente
- Mensagens CURTAS e DIRETAS (máximo 200 caracteres por mensagem)
- Se precisar falar mais, divida em múltiplas mensagens

PROCESSO DE ATENDIMENTO:

1. RECEPÇÃO DO PEDIDO:
   - Cumprimente o cliente de forma calorosa (apenas na primeira vez)
   - Identifique o que eles querem comer
   - Seja específico sobre quantidades, tamanhos, sabores

2. COLETA DE INFORMAÇÕES (uma por vez):
   - Endereço de entrega (rua, número, bairro, cidade)
   - Número de WhatsApp do cliente
   - Forma de pagamento (dinheiro, cartão, PIX)
   - Se dinheiro: quanto de troco precisa
   - Observações especiais

3. BUSCA DE RESTAURANTES:
   - Informe que está buscando as melhores opções na região
   - Explique os critérios de seleção (qualidade, avaliação, tempo de entrega)

4. APRESENTAÇÃO DE OPÇÕES:
   - Apresente 2-3 opções de restaurantes
   - Inclua nome, especialidade, tempo estimado, preço aproximado
   - Peça para o cliente escolher

5. CONFIRMAÇÃO E PEDIDO:
   - Confirme todos os detalhes do pedido
   - Informe que está entrando em contato com o restaurante
   - Atualize sobre confirmação do pedido

6. ACOMPANHAMENTO:
   - Informe tempo de preparo e entrega
   - Atualize status quando necessário

DIRETRIZES IMPORTANTES:
- SEMPRE mantenha a conversa focada em comida e delivery
- Seja proativo em perguntar detalhes importantes
- Mantenha um tom profissional mas descontraído
- NUNCA invente informações sobre restaurantes ou preços
- Sempre confirme dados importantes como endereço e telefone
- Lembre-se do contexto da conversa - não cumprimente novamente se já fez
- Mensagens CURTAS - máximo 200 caracteres
- Uma pergunta por vez

INFORMAÇÕES NECESSÁRIAS PARA PROCESSAR PEDIDO:
1. Comida desejada (tipo, sabor, tamanho)
2. Endereço completo de entrega
3. Número de WhatsApp
4. Forma de pagamento
5. Se dinheiro: valor do troco

Quando tiver TODAS essas informações, inicie o processo de busca de restaurantes.

EXEMPLO DE ATENDIMENTO:
Cliente: "Quero uma pizza"
Você: "Perfeito! Que sabor e tamanho você prefere?"

Cliente: "Margherita grande"
Você: "Ótima escolha! Qual seu endereço para entrega?"

Cliente: "Rua A, 123, Centro"
Você: "Qual seu WhatsApp para atualizações?"

E assim por diante, uma informação por vez, de forma natural e fluida.

Lembre-se: Você é o diferencial que torna o IA Fome único. Ofereça uma experiência premium que faça o cliente nunca mais querer usar outros aplicativos de delivery!
`;

// Prompt para conversar com restaurantes
const RESTAURANT_PROMPT = `
Você é um cliente fazendo um pedido de delivery. Seja natural, educado e direto. 
Forneça todas as informações necessárias: o que quer pedir, endereço de entrega, forma de pagamento.
Responda às perguntas do restaurante de forma clara e objetiva.
Mantenha um tom amigável mas profissional.
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
        stage: 'initial', // initial, collecting_info, searching_restaurant, ordering, tracking
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

    // Limitar tamanho da mensagem (máximo 200 caracteres)
    if (aiMessage.length > 200) {
      const sentences = aiMessage.split(/[.!?]+/);
      aiMessage = sentences[0] + (sentences[0].endsWith('.') || sentences[0].endsWith('!') || sentences[0].endsWith('?') ? '' : '.');
      if (aiMessage.length > 200) {
        aiMessage = aiMessage.substring(0, 197) + '...';
      }
    }

    // Extrair informações do pedido
    const messageHistory = messages.map(m => m.content).join(' ') + ' ' + message;
    
    // Detectar comida
    if (!session.orderData.food) {
      const foodMatch = messageHistory.match(/(pizza|hamburguer|lanche|sushi|japonês|chinês|italiana|brasileira|mexicana|árabe|margherita|calabresa|portuguesa|frango|carne|peixe|vegetariana)/i);
      if (foodMatch) {
        session.orderData.food = message; // Salvar a mensagem completa sobre comida
      }
    }

    // Detectar endereço
    if (!session.orderData.address) {
      const addressMatch = messageHistory.match(/(rua|avenida|av\.|r\.|endereço|entregar|entrega).+?(\d+)/i);
      if (addressMatch) {
        session.orderData.address = message; // Salvar endereço
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
      
      // Simular busca de restaurante (em produção, usar busca real)
      setTimeout(async () => {
        try {
          await simulateRestaurantOrder(session);
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

// Simular processo de pedido no restaurante
async function simulateRestaurantOrder(session) {
  try {
    // Buscar restaurantes usando Gemini
    const restaurantSearchPrompt = `
    Encontre 2-3 restaurantes reais que entregam ${session.orderData.food} na região de ${session.orderData.address}.
    Para cada restaurante, forneça:
    - Nome do restaurante
    - Telefone/WhatsApp (formato: 5524999999999)
    - Especialidade
    - Tempo estimado de entrega
    - Preço aproximado
    
    Responda apenas com os dados dos restaurantes, sem explicações.
    `;

    const searchResult = await model.generateContent(restaurantSearchPrompt);
    const restaurantData = searchResult.response.text();

    // Simular restaurante (em produção, usar dados reais)
    const mockRestaurant = {
      name: 'Pizzaria Dom José',
      phone: '5524999999999', // Número fictício para teste
      address: 'Rua das Pizzas, 123',
      specialty: 'Pizza tradicional',
      estimatedTime: '40-50 min',
      price: 'R$ 35-45'
    };

    // Criar contexto para conversar com o restaurante
    const restaurantMessage = `Olá! Gostaria de fazer um pedido para delivery.

Pedido: ${session.orderData.food}
Endereço: ${session.orderData.address}
Telefone: ${session.orderData.phone}
Pagamento: ${session.orderData.paymentMethod}
${session.orderData.change ? `Troco para: R$ ${session.orderData.change}` : ''}

Podem me confirmar o valor e tempo de entrega?`;
    
    // Enviar mensagem para o restaurante
    await sendWhatsAppMessage(mockRestaurant.phone, restaurantMessage);

    // Salvar pedido
    orders.set(session.id, {
      sessionId: session.id,
      restaurant: mockRestaurant,
      orderData: session.orderData,
      status: 'sent_to_restaurant',
      timestamp: new Date()
    });

    console.log(`Pedido enviado para ${mockRestaurant.name}`);

  } catch (error) {
    console.error('Erro ao processar pedido no restaurante:', error);
  }
}

// Função para enviar mensagem via Evolution API
async function sendWhatsAppMessage(phone, message) {
  try {
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