const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações seguras com variáveis de ambiente
const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const EVOLUTION_BASE_URL = process.env.VITE_EVOLUTION_API_URL;
const EVOLUTION_TOKEN = process.env.VITE_EVOLUTION_TOKEN;
const EVOLUTION_INSTANCE_ID = process.env.VITE_EVOLUTION_INSTANCE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// PROMPT PREMIUM
const SYSTEM_PROMPT = `
Você é o IA Fome, o concierge particular PREMIUM de delivery mais exclusivo do mundo.

PERSONALIDADE:
- Concierge 5 estrelas: atencioso, sofisticado, rápido
- SEMPRE sugira bebidas, sobremesas, acompanhamentos
- Direto ao ponto, sem enrolação
- Focado em RESULTADOS

PROCESSO:
1. PRIMEIRA INTERAÇÃO: "Olá! Sou o IA Fome, seu concierge pessoal de delivery. O que você gostaria de comer hoje? 🍕"
2. COLETA: comida, endereço, WhatsApp, pagamento (uma pergunta por vez)
3. BUSCA: "Perfeito! Buscando as melhores opções... ⏳"
4. APRESENTE 3 opções numeradas
5. CONFIRMAÇÃO: "Excelente escolha! Fazendo seu pedido..."

REGRAS:
- Mensagens curtas e práticas
- UMA pergunta por vez
- SEMPRE sugira bebidas/acompanhamentos
- Com todas as informações, BUSQUE restaurantes
- Seja honesto sobre o processo

INFORMAÇÕES OBRIGATÓRIAS:
✅ Comida + sugestão de bebida
✅ Endereço completo
✅ WhatsApp
✅ Forma de pagamento
✅ Troco (se dinheiro)
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

    console.log(`[CHAT] 🚀 NOVA ABORDAGEM: ${sessionId} - ${message}`);

    // Extrair dados diretamente das mensagens
    const orderData = extractOrderFromMessages(messages, message);
    console.log(`[CHAT] 📊 Dados extraídos:`, orderData);

    // Verificar se temos todas as informações
    const hasAllInfo = orderData.food && 
                      orderData.address && 
                      orderData.phone && 
                      orderData.paymentMethod &&
                      (orderData.paymentMethod !== 'dinheiro' || orderData.change);

    console.log(`[CHAT] ✅ Info completa: ${hasAllInfo}`);

    // 🔥 DETECÇÃO INTELIGENTE: Se cliente digitou 1, 2 ou 3 E já buscou restaurantes antes
    const isRestaurantChoice = /^[123]$/.test(message.trim());
    const previouslySearchedRestaurants = messages.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('Encontrei') || msg.content.includes('restaurantes')) &&
      msg.content.match(/[123]\./g)
    );

    if (isRestaurantChoice && previouslySearchedRestaurants) {
      console.log(`[CHAT] 🎯 CLIENTE ESCOLHEU RESTAURANTE: Opção ${message}`);
      
      // BUSCAR RESTAURANTES NOVAMENTE VIA API REAL
      const restaurants = await searchRealRestaurantsAPI(orderData);
      
      if (restaurants && restaurants.length > 0) {
        const choice = parseInt(message.trim()) - 1;
        const selectedRestaurant = restaurants[choice];
        
        if (selectedRestaurant) {
          console.log(`[CHAT] 🏪 RESTAURANTE SELECIONADO: ${selectedRestaurant.name}`);
          
          // FAZER PEDIDO REAL IMEDIATAMENTE!
          const orderSent = await makeOrderImmediately(orderData, selectedRestaurant);
          
          if (orderSent) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                message: `✅ PEDIDO ENVIADO para ${selectedRestaurant.name}!\n\n📞 ${selectedRestaurant.whatsapp}\n📍 ${selectedRestaurant.address}\n\n⏳ Aguardando confirmação...\n💰 ${selectedRestaurant.estimatedPrice}\n⏰ ${selectedRestaurant.estimatedTime}\n\nVou avisar quando responderem! 📱`,
                sessionId: sessionId
              })
            };
          } else {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                message: `😔 Erro ao contatar ${selectedRestaurant.name}.\n\nPode tentar outro ou aguarde alguns minutos.\n\nQual prefere?`,
                sessionId: sessionId
              })
            };
          }
        }
      }
    }

    // Construir contexto para IA
    let context = SYSTEM_PROMPT + "\n\n=== DADOS COLETADOS ===\n";
    context += `Comida: ${orderData.food || 'Não informado'}\n`;
    context += `Endereço: ${orderData.address || 'Não informado'}\n`;
    context += `WhatsApp: ${orderData.phone || 'Não informado'}\n`;
    context += `Pagamento: ${orderData.paymentMethod || 'Não informado'}\n`;
    context += `Troco: ${orderData.change || 'Não informado'}\n\n`;
    
    context += "=== CONVERSA ===\n";
    messages.forEach(msg => {
      context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
    });
    context += `Cliente: ${message}\nIA Fome:`;

    // Gerar resposta da IA
    const result = await model.generateContent(context);
    let aiMessage = result.response.text().trim();

    console.log(`[CHAT] 💬 Resposta IA: ${aiMessage}`);

    // 🚀 SE IA DISSE QUE VAI BUSCAR, BUSCAR AGORA MESMO VIA API REAL!
    if (hasAllInfo && (aiMessage.includes('buscando') || aiMessage.includes('Buscando') ||
        aiMessage.includes('procurando') || aiMessage.includes('encontrando'))) {
      
      console.log(`[CHAT] 🔍 IA DISSE QUE VAI BUSCAR - FAZENDO VIA API REAL!`);
      
      const restaurants = await searchRealRestaurantsAPI(orderData);
      
      if (restaurants && restaurants.length > 0) {
        let restaurantsList = "🍕 Encontrei restaurantes REAIS na sua região:\n\n";
        restaurants.forEach((rest, index) => {
          restaurantsList += `${index + 1}. **${rest.name}**\n`;
          restaurantsList += `   📞 ${rest.whatsapp}\n`;
          restaurantsList += `   📍 ${rest.address}\n`;
          restaurantsList += `   ⭐ ${rest.rating}/5 • ${rest.estimatedTime}\n`;
          restaurantsList += `   💰 ${rest.estimatedPrice}\n\n`;
        });
        restaurantsList += "Digite o NÚMERO da sua escolha (1, 2 ou 3)! 🎯";
        
        console.log(`[CHAT] 🎉 RETORNANDO OPÇÕES REAIS DIRETAMENTE!`);
        
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
            message: "😔 Não encontrei restaurantes com WhatsApp na sua região. Pode tentar outro tipo de comida?",
            sessionId: sessionId
          })
        };
      }
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

// 🔍 BUSCAR RESTAURANTES VIA API REAL
async function searchRealRestaurantsAPI(orderData) {
  try {
    console.log(`[API] 🔍 BUSCANDO VIA API REAL...`);
    
    // Extrair cidade do endereço
    let city = 'Volta Redonda';
    if (orderData.address) {
      const addressParts = orderData.address.split(',');
      if (addressParts.length > 1) {
        city = addressParts[addressParts.length - 1].trim();
      } else {
        // Tentar extrair cidade de outra forma
        const cityKeywords = ['volta redonda', 'rio de janeiro', 'niterói', 'são paulo', 'belo horizonte'];
        for (const keyword of cityKeywords) {
          if (orderData.address.toLowerCase().includes(keyword)) {
            city = keyword.split(' ').map(word => 
              word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');
            break;
          }
        }
      }
    }
    
    console.log(`[API] 📍 Cidade extraída: ${city}`);
    
    // Chamar nossa API de busca
    const apiUrl = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/search-restaurants`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        food: orderData.food,
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

// Extrair dados do pedido de TODAS as mensagens
function extractOrderFromMessages(messages, currentMessage) {
  const allMessages = [...messages.map(m => m.content), currentMessage].join(' ').toLowerCase();
  
  console.log(`[EXTRACT] 🔍 Analisando todas as mensagens...`);
  
  const orderData = {
    food: null,
    address: null,
    phone: null,
    paymentMethod: null,
    change: null
  };

  // Extrair COMIDA
  const foodKeywords = ['pizza', 'hamburguer', 'sushi', 'lanche', 'combo'];
  for (const keyword of foodKeywords) {
    if (allMessages.includes(keyword)) {
      // Pegar a mensagem que contém comida
      for (const msg of messages) {
        if (msg.content.toLowerCase().includes(keyword)) {
          orderData.food = msg.content;
          break;
        }
      }
      if (!orderData.food && currentMessage.toLowerCase().includes(keyword)) {
        orderData.food = currentMessage;
      }
      break;
    }
  }

  // Extrair ENDEREÇO
  const addressPatterns = [
    /rua\s+[^,]+,?\s*n?\s*\d+/i,
    /avenida\s+[^,]+,?\s*\d+/i,
    /entregar\s+em[^.]+/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = allMessages.match(pattern);
    if (match) {
      orderData.address = match[0];
      break;
    }
  }

  // Extrair TELEFONE
  const phoneMatch = allMessages.match(/(\d{10,11})/);
  if (phoneMatch) {
    orderData.phone = phoneMatch[1];
  }

  // Extrair PAGAMENTO
  if (allMessages.includes('cartão') || allMessages.includes('cartao')) {
    orderData.paymentMethod = 'cartão';
  } else if (allMessages.includes('dinheiro') || allMessages.includes('espécie')) {
    orderData.paymentMethod = 'dinheiro';
  } else if (allMessages.includes('pix')) {
    orderData.paymentMethod = 'pix';
  }

  // Extrair TROCO
  const changeMatch = allMessages.match(/troco.*?(\d+)/i);
  if (changeMatch) {
    orderData.change = changeMatch[1];
  }

  console.log(`[EXTRACT] 📝 Dados extraídos:`, orderData);
  return orderData;
}

// 📞 FAZER PEDIDO IMEDIATAMENTE
async function makeOrderImmediately(orderData, restaurant) {
  try {
    console.log(`[PEDIDO] 📞 FAZENDO PEDIDO REAL AGORA!`);
    console.log(`[PEDIDO] 🏪 Restaurante: ${restaurant.name}`);
    console.log(`[PEDIDO] 📱 WhatsApp: ${restaurant.whatsapp}`);

    // Criar mensagem realista
    const orderMessage = `Olá! 😊

Gostaria de fazer um pedido para entrega:

🍕 PEDIDO:
${orderData.food}

📍 ENDEREÇO DE ENTREGA:
${orderData.address}

📱 CONTATO:
${orderData.phone}

💰 FORMA DE PAGAMENTO:
${orderData.paymentMethod}${orderData.change ? ` (Troco para R$ ${orderData.change})` : ''}

Podem me confirmar o valor total e o tempo de entrega?

Obrigado! 🙏`;

    console.log(`[PEDIDO] 📝 MENSAGEM:`);
    console.log(orderMessage);

    // ENVIAR VIA EVOLUTION
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
    console.log(`[WHATSAPP] 📱 ENVIANDO PARA: ${phone}`);
    
    if (!EVOLUTION_BASE_URL || !EVOLUTION_TOKEN || !EVOLUTION_INSTANCE_ID) {
      console.error(`[WHATSAPP] ❌ VARIÁVEIS FALTANDO!`);
      return false;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const url = `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE_ID}`;
    
    console.log(`[WHATSAPP] 🌐 URL: ${url}`);
    console.log(`[WHATSAPP] 📞 Telefone limpo: ${cleanPhone}`);

    const payload = {
      number: cleanPhone,
      text: message
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
      },
      body: JSON.stringify(payload)
    });

    console.log(`[WHATSAPP] 📊 Status: ${response.status}`);

    if (response.ok) {
      const result = await response.text();
      console.log(`[WHATSAPP] ✅ SUCESSO! Resposta: ${result.substring(0, 100)}...`);
      return true;
    } else {
      const error = await response.text();
      console.error(`[WHATSAPP] ❌ ERRO ${response.status}: ${error}`);
      return false;
    }
    
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Erro crítico:`, error);
    return false;
  }
}
