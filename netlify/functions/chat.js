const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// 🆕 ARMAZENAMENTO EM MEMÓRIA PARA ESTADOS DAS SESSÕES
const sessionStates = new Map();
const orderData = new Map();

// ✨ PROMPT PREMIUM DEFINITIVO - O MELHOR CONCIERGE DO MUNDO
const SYSTEM_PROMPT = `
Você é o IA Fome, o concierge pessoal PREMIUM de delivery mais exclusivo e profissional do Brasil.

🎩 PERSONALIDADE DEFINITIVA:
- Concierge 5 estrelas: refinado, atencioso, eficiente
- Cumprimente educadamente mas JÁ respondendo à solicitação
- Chame de Sr./Srta. + NOME (pergunte o nome na primeira interação)
- Seja DIRETO mas extremamente educado e profissional
- SEMPRE ofereça sugestões inteligentes de acompanhamentos
- Demonstre conhecimento especializado sobre gastronomia
- Tranquilize o cliente durante todo o processo

🎯 PROCESSO INTELIGENTE:
1️⃣ PRIMEIRA INTERAÇÃO: "Boa [tarde/noite]! Sou o IA Fome, seu concierge pessoal de delivery. Para oferecer o melhor atendimento, qual seu nome? E o que gostaria de saborear hoje?"

2️⃣ COLETA INTELIGENTE (uma pergunta por vez, mas eficiente):
   • Nome do cliente
   • Tipo de comida + detalhes específicos (ser MUITO inteligente aqui)
   • Endereço completo
   • WhatsApp
   • Forma de pagamento
   • Troco (se dinheiro)

3️⃣ INTELIGÊNCIA GASTRONÔMICA:
   • PIZZA: "Perfeito, Sr. João! Qual sabor de pizza prefere? Temos tradicionais como Marguerita, Calabresa, ou algo mais especial como Portuguesa? E que tal uma bebida gelada para acompanhar?"
   • HOT DOG: "Excelente escolha! Prefere completo (batata palha, milho, ervilha) ou tem alguma preferência específica? E uma bebida?"
   • HAMBÚRGUER: "Ótima escolha! Prefere artesanal ou tradicional? Gostaria com bacon, queijo especial? E que tal batata e refrigerante?"
   • SUSHI: "Sofisticado! Prefere combinados tradicionais ou tem alguma preferência específica (salmão, atum)? Hashi ou talher?"

4️⃣ CONFIRMAÇÃO PROFISSIONAL: "Perfeito, Sr./Srta. [NOME]! Recapitulando seu pedido: [PEDIDO DETALHADO]. Endereço: [ENDEREÇO]. Pagamento: [FORMA]. Está tudo correto? Gostaria de adicionar mais alguma coisa?"

5️⃣ BUSCA: "Excelente! Localizando os melhores restaurantes na sua região... ⏳"

6️⃣ APRESENTAÇÃO: [FORMATO ESPECIAL ABAIXO]

7️⃣ TRANQUILIZAÇÃO PÓS-PEDIDO: "Perfeito, Sr./Srta. [NOME]! Seu pedido foi enviado com sucesso para [RESTAURANTE]! 🎉 Pode ficar tranquilo(a) que vou te manter informado(a) tanto aqui no chat quanto por WhatsApp sobre todas as atualizações. Em breve eles vão confirmar e começar o preparo. O tempo estimado é de [TEMPO]. Relaxe que está tudo sob meu controle! ✨"

🍽️ INTELIGÊNCIA ESPECIALIZADA POR TIPO:
- PIZZA: Sabores, tamanho, borda, bebidas
- HAMBÚRGUER: Ponto da carne, adicionais, combos
- HOT DOG: Tipo de salsicha, adicionais, molhos
- SUSHI: Tipos de peixe, combinados, quantidades
- AÇAÍ: Tamanho, acompanhamentos, coberturas
- COMIDA BRASILEIRA: Acompanhamentos, temperos
- FAST FOOD: Combos, tamanhos, bebidas

💎 REGRAS DEFINITIVAS:
- Mensagens elegantes mas concisas (máximo 3 linhas por pergunta)
- UMA pergunta específica por vez
- SEMPRE sugira acompanhamentos relevantes
- Use o nome do cliente consistentemente
- Seja proativo em resolver problemas
- NUNCA invente restaurantes
- Tranquilize durante esperas
- Mencione notificações por WhatsApp sempre

🎨 TOM DEFINITIVO:
- Elegante mas acessível
- Profissional mas caloroso
- Eficiente mas atencioso
- Confiante mas humilde
- Especialista mas simpático

LEMBRE-SE: Você é o MELHOR concierge de delivery do mundo. Cada interação deve ser uma experiência premium única!
`;

const POST_ORDER_PROMPT = `
Você é o IA Fome, concierge premium, e já enviou um pedido com sucesso.

🎩 PERSONALIDADE PÓS-PEDIDO:
- Tranquilizador e extremamente confiante
- Use sempre Sr./Srta. + nome do cliente
- Informe sobre notificações por WhatsApp
- Seja proativo e atencioso
- Mantenha o tom premium

📱 SITUAÇÃO: O pedido JÁ FOI ENVIADO e confirmado pelo restaurante.

✨ RESPOSTAS PREMIUM:
- Agradecimentos: "De nada, Sr./Srta. [NOME]! É um prazer cuidar do seu pedido! 😊 Vou te manter informado(a) tanto aqui quanto por WhatsApp."
- Dúvidas de tempo: "Claro! O tempo estimado continua sendo [X] minutos. Te aviso por WhatsApp quando sair para entrega!"
- Preocupações: "Fique tranquilo(a), Sr./Srta. [NOME]! Tudo está correndo perfeitamente. O restaurante confirmou e está preparando seu pedido."
- Status: "Seu pedido está [STATUS]. Te notificarei por WhatsApp assim que houver atualizações!"

REGRAS:
- SEMPRE use o nome do cliente
- SEMPRE mencione notificações por WhatsApp
- Seja tranquilizador e confiante
- Mantenha a elegância
- NÃO mostre restaurantes novamente

O cliente deve se sentir completamente cuidado e tranquilo!
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
        body: JSON.stringify({ error: 'SessionId e message são obrigatórios' })
      };
    }

    console.log(`[CHAT] 🚀 NOVA MENSAGEM: ${sessionId} - ${message}`);

    // 🆕 VERIFICAR ESTADO DA SESSÃO
    const currentState = sessionStates.get(sessionId) || 'collecting_info';
    console.log(`[CHAT] 📊 Estado atual: ${currentState}`);

    // 🆕 SE JÁ ENVIOU PEDIDO, USA PROMPT DIFERENTE
    if (currentState === 'order_sent') {
      console.log(`[CHAT] 📦 PEDIDO JÁ ENVIADO - Usando prompt pós-pedido`);
      
      const orderInfo = orderData.get(sessionId) || {};
      
      let context = POST_ORDER_PROMPT + "\n\n=== INFORMAÇÕES DO PEDIDO ENVIADO ===\n";
      context += `Cliente: ${orderInfo.clientName || 'Cliente'}\n`;
      context += `Restaurante: ${orderInfo.selectedRestaurant?.name || 'Restaurante selecionado'}\n`;
      context += `Comida: ${orderInfo.food || 'Pedido realizado'}\n`;
      context += `Status: Pedido enviado e confirmado\n\n`;
      
      context += "=== CONVERSA ATUAL ===\n";
      messages.slice(-3).forEach(msg => {
        context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
      });
      context += `Cliente: ${message}\nIA Fome:`;

      // Gerar resposta pós-pedido
      const result = await model.generateContent(context);
      let aiMessage = result.response.text().trim();

      console.log(`[CHAT] 💬 Resposta pós-pedido: ${aiMessage}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: aiMessage,
          sessionId: sessionId
        })
      };
    }

    // 🧠 EXTRAIR DADOS COM INTELIGÊNCIA MELHORADA
    const extractedData = extractOrderFromMessagesIntelligent(messages, message);
    console.log(`[CHAT] 📊 Dados extraídos:`, extractedData);

    // Verificar se temos todas as informações OBRIGATÓRIAS
    const hasAllInfo = !!(extractedData.food && 
                         extractedData.address && 
                         extractedData.phone && 
                         extractedData.paymentMethod &&
                         extractedData.clientName &&
                         (extractedData.paymentMethod !== 'dinheiro' || extractedData.change));

    console.log(`[CHAT] ✅ Info completa: ${hasAllInfo}`);

    // 🔥 DETECÇÃO: Se cliente escolheu restaurante
    const isRestaurantChoice = /^[123]$/.test(message.trim());
    const previouslySearchedRestaurants = messages.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('🏆') || msg.content.includes('melhores opções')) &&
      msg.content.match(/[123]\.\s*\*\*/g)
    );

    if (isRestaurantChoice && previouslySearchedRestaurants && currentState !== 'order_sent') {
      console.log(`[CHAT] 🎯 CLIENTE ESCOLHEU RESTAURANTE: Opção ${message}`);
      
      // BUSCAR RESTAURANTES NOVAMENTE VIA API REAL
      const restaurants = await searchRealRestaurantsAPI(extractedData);
      
      if (restaurants && restaurants.length > 0) {
        const choice = parseInt(message.trim()) - 1;
        const selectedRestaurant = restaurants[choice];
        
        if (selectedRestaurant) {
          console.log(`[CHAT] 🏪 RESTAURANTE SELECIONADO: ${selectedRestaurant.name}`);
          
          // 🆕 SALVAR DADOS DO PEDIDO
          orderData.set(sessionId, {
            ...extractedData,
            selectedRestaurant: selectedRestaurant
          });
          
          // FAZER PEDIDO REAL IMEDIATAMENTE!
          const orderSent = await makeOrderImmediately(extractedData, selectedRestaurant, sessionId);
          
          if (orderSent) {
            // 🆕 ATUALIZAR ESTADO DA SESSÃO
            sessionStates.set(sessionId, 'order_sent');
            
            const clientName = extractedData.clientName || 'Cliente';
            
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                message: `🎉 Perfeito, ${clientName}! Seu pedido foi enviado com sucesso para **${selectedRestaurant.name}**!\n\n📱 Pode ficar tranquilo(a) que vou te manter informado(a) tanto aqui no chat quanto por **WhatsApp** sobre todas as atualizações!\n\n⏰ **Tempo estimado**: ${selectedRestaurant.estimatedTime}\n💰 **Valor estimado**: ${selectedRestaurant.estimatedPrice}\n\n🔔 Em breve eles vão confirmar e começar o preparo. Te aviso por WhatsApp quando houver novidades!\n\nRelaxe que está tudo sob meu controle! ✨`,
                sessionId: sessionId
              })
            };
          } else {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                message: `😔 ${extractedData.clientName || 'Cliente'}, houve um problema ao contatar ${selectedRestaurant.name}.\n\nPode escolher outro restaurante ou aguarde alguns minutos que tentarei novamente.\n\nQual prefere?`,
                sessionId: sessionId
              })
            };
          }
        }
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: "😔 Erro ao carregar restaurantes. Tente novamente em alguns minutos.",
          sessionId: sessionId
        })
      };
    }

    // 🚀 SE TEMOS TODAS AS INFORMAÇÕES, BUSCAR RESTAURANTES AUTOMATICAMENTE!
    if (hasAllInfo && currentState !== 'order_sent') {
      console.log(`[CHAT] 🔍 TODAS INFORMAÇÕES COLETADAS - BUSCANDO RESTAURANTES!`);
      
      const restaurants = await searchRealRestaurantsAPI(extractedData);
      
      if (restaurants && restaurants.length > 0) {
        const clientName = extractedData.clientName || 'Cliente';
        let restaurantsList = `🏆 Perfeito, ${clientName}! Encontrei as **melhores opções** na sua região:\n\n`;
        
        restaurants.forEach((rest, index) => {
          restaurantsList += `**${index + 1}. ${rest.name}** ⭐ ${rest.rating}/5\n`;
          restaurantsList += `   ⏰ ${rest.estimatedTime} • 💰 ${rest.estimatedPrice}\n`;
          restaurantsList += `   📍 ${rest.address}\n`;
          restaurantsList += `   📱 WhatsApp: ${rest.whatsapp}\n\n`;
        });
        
        restaurantsList += `🎯 **Digite o número da sua escolha (1, 2 ou 3)** para eu fazer seu pedido imediatamente!\n\nQual prefere, ${clientName}?`;
        
        console.log(`[CHAT] 🎉 RETORNANDO RESTAURANTES REAIS!`);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: restaurantsList,
            sessionId: sessionId
          })
        };
      } else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: `😔 ${extractedData.clientName || 'Cliente'}, não encontrei restaurantes disponíveis na sua região no momento.\n\nPoderia tentar outro tipo de comida ou me dar mais detalhes da sua localização?`,
            sessionId: sessionId
          })
        };
      }
    }

    // Construir contexto para IA (só se não tiver todas as informações)
    let context = SYSTEM_PROMPT + "\n\n=== DADOS COLETADOS ===\n";
    context += `Nome: ${extractedData.clientName || 'Não informado'}\n`;
    context += `Comida: ${extractedData.food || 'Não informado'}\n`;
    context += `Endereço: ${extractedData.address || 'Não informado'}\n`;
    context += `Cidade: ${extractedData.city || 'Não informado'}\n`;
    context += `WhatsApp: ${extractedData.phone || 'Não informado'}\n`;
    context += `Pagamento: ${extractedData.paymentMethod || 'Não informado'}\n`;
    context += `Troco: ${extractedData.change || 'Não informado'}\n\n`;
    
    // Determinar período do dia para cumprimento
    const hour = new Date().getHours();
    let greeting = 'Boa noite';
    if (hour >= 5 && hour < 12) greeting = 'Bom dia';
    else if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
    
    context += `Período: ${greeting}\n\n`;
    
    context += "=== CONVERSA ===\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    let aiMessage = result.response.text().trim();

    console.log(`[CHAT] 💬 Resposta IA: ${aiMessage}`);

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

// 🧠 EXTRAÇÃO INTELIGENTE MELHORADA
function extractOrderFromMessagesIntelligent(messages, currentMessage) {
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');
  
  const allUserText = `${userMessages} ${currentMessage}`.toLowerCase();
  
  const extractedData = {
    clientName: null,
    food: null,
    foodType: null,
    address: null,
    city: null,
    phone: null,
    paymentMethod: null,
    change: null
  };

  // 👤 EXTRAIR NOME - MELHORADO
  const namePatterns = [
    /(?:meu nome é|me chamo|sou o|sou a|eu sou)\s+([a-záêçõãíé\s]+)(?:\s|$|\.)/i,
    /nome:?\s*([a-záêçõãíé\s]+)(?:\s|$|\.)/i,
    /^([a-záêçõãíé]+)\s*(?:,|$)/i  // Primeira palavra se for só um nome
  ];
  
  for (const pattern of namePatterns) {
    const match = allUserText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .substring(0, 30); // Limitar tamanho
      
      if (name.length >= 2 && !name.match(/\d/)) {
        extractedData.clientName = name;
        break;
      }
    }
  }

  // 🍕 EXTRAIR COMIDA - INTELIGENTE
  const foodKeywords = [
    { keywords: ['pizza'], type: 'pizza' },
    { keywords: ['hamburguer', 'hamburger', 'burger'], type: 'hamburguer' },
    { keywords: ['hot dog', 'hotdog', 'cachorro quente'], type: 'hot dog' },
    { keywords: ['sushi', 'sashimi', 'temaki'], type: 'sushi' },
    { keywords: ['lanche', 'sanduiche', 'combo'], type: 'lanche' },
    { keywords: ['pastel'], type: 'pastel' },
    { keywords: ['açaí'], type: 'açaí' },
    { keywords: ['churrasco', 'carne'], type: 'churrasco' },
    { keywords: ['comida chinesa', 'yakisoba'], type: 'chinesa' },
    { keywords: ['pizza', 'esfiha'], type: 'pizza' }
  ];
  
  for (const { keywords, type } of foodKeywords) {
    for (const keyword of keywords) {
      if (allUserText.includes(keyword)) {
        const userMessagesWithCurrent = [...messages.filter(msg => msg.role === 'user').map(m => m.content), currentMessage];
        
        for (const msg of userMessagesWithCurrent) {
          if (msg.toLowerCase().includes(keyword)) {
            extractedData.food = msg;
            extractedData.foodType = type;
            console.log(`[EXTRACT] 🍕 Comida: ${keyword} -> ${type}`);
            break;
          }
        }
        break;
      }
    }
    if (extractedData.foodType) break;
  }

  // 📍 EXTRAIR ENDEREÇO E CIDADE - MELHORADO
  const addressPatterns = [
    /(?:endere[çc]o:?\s*|entregar?\s+(?:em|no|na):?\s*|moro\s+(?:em|no|na)\s*)([^.\n]+)/i,
    /(?:rua|avenida|av\.?|r\.?)\s+[^,\n]+(?:,?\s*n?\.?\s*\d+)?(?:,\s*[^,\n]+)*/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = allUserText.match(pattern);
    if (match) {
      extractedData.address = match[0];
      
      // Extrair cidade - MELHORADO com mais cidades
      const addressText = match[0].toLowerCase();
      
      const knownCities = [
        'volta redonda', 'rio de janeiro', 'niterói', 'são paulo', 'belo horizonte',
        'brasília', 'salvador', 'fortaleza', 'recife', 'curitiba', 'porto alegre',
        'goiânia', 'campinas', 'santos', 'sorocaba', 'ribeirão preto', 'são josé dos campos',
        'uberlândia', 'contagem', 'feira de santana', 'joinville', 'londrina', 'maringá'
      ];
      
      for (const city of knownCities) {
        if (addressText.includes(city)) {
          extractedData.city = city.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
          break;
        }
      }
      
      if (!extractedData.city) {
        extractedData.city = 'Volta Redonda'; // Fallback
      }
      
      break;
    }
  }

  // 📱 EXTRAIR TELEFONE - MELHORADO
  const phonePatterns = [
    /(?:whatsapp|telefone|contato|número).*?(\d{2})\s*(\d{9})/i,
    /(\d{2})\s+(\d{4,5})[\s-]?(\d{4})/g,
    /(\d{10,11})(?!\d)/g
  ];
  
  for (const pattern of phonePatterns) {
    const matches = allUserText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleanPhone = match.replace(/\D/g, '');
        if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
          extractedData.phone = cleanPhone;
          break;
        }
      }
      if (extractedData.phone) break;
    }
  }

  // 💳 EXTRAIR PAGAMENTO
  if (allUserText.includes('cartão') || allUserText.includes('cartao')) {
    extractedData.paymentMethod = 'cartão';
  } else if (allUserText.includes('dinheiro') || allUserText.includes('espécie')) {
    extractedData.paymentMethod = 'dinheiro';
  } else if (allUserText.includes('pix')) {
    extractedData.paymentMethod = 'pix';
  }

  // 💰 EXTRAIR TROCO
  const changeMatch = allUserText.match(/troco.*?(\d+)/i);
  if (changeMatch) {
    extractedData.change = changeMatch[1];
  }

  console.log(`[EXTRACT] 📝 Dados extraídos:`, extractedData);
  return extractedData;
}

// 🔍 BUSCAR RESTAURANTES VIA API REAL - ADAPTADO PARA QUALQUER CIDADE
async function searchRealRestaurantsAPI(extractedData) {
  try {
    console.log(`[API] 🔍 BUSCANDO VIA API REAL...`);
    
    const city = extractedData.city || 'Volta Redonda';
    const foodType = extractedData.foodType || 'pizza';
    
    console.log(`[API] 📍 Cidade: ${city}, Comida: ${foodType}`);
    
    const apiUrl = `${process.env.URL || 'https://iafome.netlify.app'}/.netlify/functions/search-restaurants`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        food: foodType,
        city: city,
        state: 'RJ'
      })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.restaurants && data.restaurants.length > 0) {
      console.log(`[API] ✅ ${data.restaurants.length} restaurantes encontrados!`);
      return data.restaurants;
    } else {
      console.log(`[API] ❌ Nenhum restaurante encontrado`);
      return [];
    }
    
  } catch (error) {
    console.error(`[API] ❌ Erro na busca:`, error);
    return [];
  }
}

// 📞 FAZER PEDIDO IMEDIATAMENTE - MELHORADO COM DADOS DO PEDIDO SALVOS
async function makeOrderImmediately(extractedData, restaurant, sessionId) {
  try {
    console.log(`[PEDIDO] 📞 FAZENDO PEDIDO REAL!`);
    
    // 🆕 SALVAR DADOS COMPLETOS DO PEDIDO PARA O WEBHOOK
    const completeOrderData = {
      sessionId: sessionId,
      orderData: extractedData, // Dados do cliente
      restaurant: restaurant,   // Dados do restaurante
      status: 'sent',
      timestamp: new Date().toISOString()
    };

    // Salvar no Map global para o webhook acessar
    const orders = global.orders || (global.orders = new Map());
    orders.set(sessionId, completeOrderData);
    
    console.log(`[PEDIDO] 💾 Dados salvos para sessão: ${sessionId}`);
    console.log(`[PEDIDO] 🏪 Restaurante: ${restaurant.name} - ${restaurant.whatsapp}`);

    let cleanAddress = extractedData.address;
    if (cleanAddress) {
      cleanAddress = cleanAddress
        .replace(/para pagar no cartão|vou pagar no cartão/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const clientName = extractedData.clientName || 'Cliente';
    const orderMessage = `Oi, tudo bem? Sou o ${clientName} e gostaria de fazer um pedido para entrega:

🍕 **Pedido**: ${extractedData.food}
📍 **Endereço**: ${cleanAddress}
💳 **Pagamento**: ${extractedData.paymentMethod}${extractedData.change ? ` (Troco para R$ ${extractedData.change})` : ''}

Poderiam me confirmar o valor total e o tempo de entrega, por favor?

Obrigado! 🙏`;

    console.log(`[PEDIDO] 📝 Enviando pedido...`);
    
    const success = await sendWhatsAppReal(restaurant.whatsapp, orderMessage);
    
    if (success) {
      console.log(`[PEDIDO] ✅ PEDIDO ENVIADO COM SUCESSO!`);
      return true;
    } else {
      console.log(`[PEDIDO] ❌ ERRO AO ENVIAR!`);
      return false;
    }
    
  } catch (error) {
    console.error(`[PEDIDO] ❌ Erro:`, error);
    return false;
  }
}

// 📱 ENVIAR WHATSAPP REAL
async function sendWhatsAppReal(phone, message) {
  try {
    if (!EVOLUTION_BASE_URL || !EVOLUTION_TOKEN || !EVOLUTION_INSTANCE_ID) {
      console.error(`[WHATSAPP] ❌ Configurações faltando!`);
      return false;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const url = `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ID}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message
      })
    });

    if (response.ok) {
      console.log(`[WHATSAPP] ✅ Mensagem enviada!`);
      return true;
    } else {
      console.error(`[WHATSAPP] ❌ Erro ${response.status}`);
      return false;
    }
    
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Erro crítico:`, error);
    return false;
  }
}
