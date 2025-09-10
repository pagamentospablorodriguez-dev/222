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

PROCESSO DE ATENDIMENTO:

1. RECEPÇÃO DO PEDIDO:
   - Cumprimente o cliente de forma calorosa
   - Identifique o que eles querem comer
   - Seja específico sobre quantidades, tamanhos, sabores

2. COLETA DE INFORMAÇÕES:
   - Endereço de entrega (rua, número, bairro, cidade)
   - Número de WhatsApp do cliente
   - Preferências específicas ou restrições

3. BUSCA DE RESTAURANTES:
   - Informe que está buscando as melhores opções na região
   - Explique os critérios de seleção (qualidade, avaliação, tempo de entrega)

4. APRESENTAÇÃO DE OPÇÕES:
   - Apresente 1-3 opções de restaurantes
   - Inclua nome, especialidade, tempo estimado
   - Mencione preços estimados quando possível

5. CONFIRMAÇÃO E PEDIDO:
   - Confirme todos os detalhes do pedido
   - Método de pagamento (padrão: dinheiro na entrega)
   - Confirme se precisa de troco

6. ACOMPANHAMENTO:
   - Informe que está entrando em contato com o restaurante
   - Atualize sobre confirmação do pedido
   - Informe tempo de preparo e entrega

DIRETRIZES IMPORTANTES:
- SEMPRE mantenha a conversa focada em comida e delivery
- Seja proativo em perguntar detalhes importantes
- Ofereça sugestões relevantes (bebidas, sobremesas, acompanhamentos)
- Mantenha um tom profissional mas descontraído
- Se não souber alguma informação específica, seja honesto
- NUNCA invente informações sobre restaurantes ou preços
- Sempre confirme dados importantes como endereço e telefone

EXEMPLO DE ATENDIMENTO:
Cliente: "Quero uma pizza"
Você: "Perfeito! Vou te ajudar com isso. Para encontrar as melhores pizzarias da sua região, preciso de algumas informações:

🍕 Que tamanho de pizza você prefere? (pequena, média, grande, família)
🧀 Qual sabor você tem em mente?
🥤 Vai querer alguma bebida para acompanhar?
📍 Qual o seu endereço para entrega?
📱 Qual seu WhatsApp para eu manter você atualizado?

Com essas informações, vou encontrar as melhores opções na sua região!"

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
    const aiMessage = response.text().trim();

    // Analisar se temos informações suficientes para fazer o pedido
    const hasFood = /pizza|hamburguer|lanche|comida|prato|sushi|japonês|chinês|italiana|brasileira|mexicana|árabe/i.test(message + ' ' + messages.map(m => m.content).join(' '));
    const hasAddress = /rua|avenida|av\.|r\.|endereço|entregar|entrega/i.test(message + ' ' + messages.map(m => m.content).join(' '));
    const hasPhone = /\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4}/i.test(message + ' ' + messages.map(m => m.content).join(' '));

    // Se temos todas as informações, iniciar processo de pedido
    if (hasFood && hasAddress && hasPhone && session.stage === 'initial') {
      session.stage = 'searching_restaurant';
      
      // Extrair informações
      const phoneMatch = (message + ' ' + messages.map(m => m.content).join(' ')).match(/(\d{10,11}|\(\d{2}\)\s*\d{4,5}-?\d{4})/);
      if (phoneMatch) {
        session.userPhone = phoneMatch[0].replace(/\D/g, '');
      }

      // Simular busca de restaurante (em produção, usar Google Places API)
      setTimeout(async () => {
        try {
          await simulateRestaurantOrder(session, message);
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

// Simular processo de pedido no restaurante
async function simulateRestaurantOrder(session, orderDetails) {
  try {
    // Simular busca de restaurante
    const mockRestaurant = {
      name: 'Pizzaria Dom José',
      phone: '5524999999999', // Número fictício para teste
      address: 'Rua das Pizzas, 123'
    };

    // Criar contexto para conversar com o restaurante
    const restaurantContext = RESTAURANT_PROMPT + `\n\nDetalhes do pedido: ${orderDetails}\n\nCliente:`;

    // Simular conversa com restaurante via WhatsApp
    const restaurantMessage = `Olá! Gostaria de fazer um pedido para delivery. ${orderDetails}`;
    
    // Enviar mensagem para o restaurante
    await sendWhatsAppMessage(mockRestaurant.phone, restaurantMessage);

    // Salvar pedido
    orders.set(session.id, {
      sessionId: session.id,
      restaurant: mockRestaurant,
      details: orderDetails,
      status: 'sent_to_restaurant',
      timestamp: new Date()
    });

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