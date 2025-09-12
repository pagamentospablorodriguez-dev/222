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

IMPORTANTE: NUNCA invente restaurantes! Sempre aguarde a busca real retornar as opções.
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

    // Extrair dados diretamente das mensagens
    const orderData = extractOrderFromMessages(messages, message);
    console.log(`[CHAT] 📊 Dados extraídos:`, orderData);

    // Verificar se temos todas as informações OBRIGATÓRIAS
    const hasAllInfo = !!(orderData.food && 
                         orderData.address && 
                         orderData.phone && 
                         orderData.paymentMethod &&
                         (orderData.paymentMethod !== 'dinheiro' || orderData.change));

    console.log(`[CHAT] ✅ Info completa: ${hasAllInfo}`);
    console.log(`[CHAT] 🔍 Detalhes:`, {
      food: !!orderData.food,
      address: !!orderData.address,
      phone: !!orderData.phone,
      payment: !!orderData.paymentMethod
    });

    // 🔥 DETECÇÃO: Se cliente escolheu restaurante (1, 2 ou 3)
    const isRestaurantChoice = /^[123]$/.test(message.trim());
    const previouslySearchedRestaurants = messages.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('Encontrei') || msg.content.includes('restaurantes REAIS')) &&
      msg.content.match(/[123]\.\s*\*\*/g)
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
    if (hasAllInfo) {
      console.log(`[CHAT] 🔍 TODAS INFORMAÇÕES COLETADAS - BUSCANDO RESTAURANTES AUTOMATICAMENTE!`);
      
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
        
        console.log(`[CHAT] 🎉 RETORNANDO RESTAURANTES REAIS AUTOMATICAMENTE!`);
        
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
            message: "😔 Não encontrei restaurantes com WhatsApp na sua região.\n\nPode tentar outro tipo de comida ou me dar mais detalhes da sua localização?",
            sessionId: sessionId
          })
        };
      }
    }

    // Construir contexto para IA (só se não tiver todas as informações)
    let context = SYSTEM_PROMPT + "\n\n=== DADOS COLETADOS ===\n";
    context += `Comida: ${orderData.food || 'Não informado'}\n`;
    context += `Endereço: ${orderData.address || 'Não informado'}\n`;
    context += `Cidade: ${orderData.city || 'Não informado'}\n`;
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
    console.log(`[API] 📊 OrderData:`, orderData);
    
    // Usar a cidade já extraída ou fallback
    const city = orderData.city || 'Volta Redonda';
    
    console.log(`[API] 📍 Cidade para busca: ${city}`);
    console.log(`[API] 🍕 Comida: ${orderData.food}`);
    
    // Chamar nossa API de busca
    const apiUrl = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/search-restaurants`;
    
    console.log(`[API] 🌐 Chamando: ${apiUrl}`);
    
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
    
    console.log(`[API] 📊 Status da resposta: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API] ❌ Erro ${response.status}: ${errorText}`);
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`[API] 📋 Resposta:`, data);
    
    if (data.success && data.restaurants && data.restaurants.length > 0) {
      console.log(`[API] ✅ ${data.restaurants.length} restaurantes encontrados!`);
      return data.restaurants;
    } else {
      console.log(`[API] ❌ Nenhum restaurante encontrado - Detalhes:`, data);
      return [];
    }
    
  } catch (error) {
    console.error(`[API] ❌ Erro crítico na busca:`, error);
    return [];
  }
}

// Extrair dados do pedido de TODAS as mensagens
function extractOrderFromMessages(messages, currentMessage) {
  // Combinar todas as mensagens do usuário
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');
  
  const allUserText = `${userMessages} ${currentMessage}`.toLowerCase();
  
  console.log(`[EXTRACT] 🔍 Texto completo do usuário: ${allUserText.substring(0, 200)}...`);
  
  const orderData = {
    food: null,
    address: null,
    city: null,
    phone: null,
    paymentMethod: null,
    change: null
  };

  // Extrair COMIDA - buscar na mensagem mais recente que contém comida
  const foodKeywords = ['pizza', 'hamburguer', 'hamburger', 'sushi', 'lanche', 'combo', 'sanduiche', 'pastel', 'açaí'];
  
  for (const keyword of foodKeywords) {
    if (allUserText.includes(keyword)) {
      // Buscar nas mensagens do usuário (não nas do assistente)
      const userMessagesWithCurrent = [...messages.filter(msg => msg.role === 'user').map(m => m.content), currentMessage];
      
      for (const msg of userMessagesWithCurrent) {
        if (msg.toLowerCase().includes(keyword)) {
          orderData.food = msg;
          break;
        }
      }
      break;
    }
  }

  // Extrair ENDEREÇO E CIDADE
  const addressPatterns = [
    /(?:rua|avenida|av\.?|r\.?)\s+[^,\n]+(?:,?\s*n?\.?\s*\d+)?(?:,\s*[^,\n]+)*/i,
    /entregar?\s+em:?\s*([^.\n]+)/i,
    /endere[çc]o:?\s*([^.\n]+)/i,
    /pra\s+entregar\s+em\s+([^.\n]+)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = allUserText.match(pattern);
    if (match) {
      orderData.address = match[0];
      
      // Extrair cidade do endereço
      const addressText = match[0].toLowerCase();
      
      // Procurar por cidades conhecidas
      const knownCities = [
        'volta redonda', 'rio de janeiro', 'niterói', 'são paulo', 
        'belo horizonte', 'brasília', 'salvador', 'fortaleza',
        'recife', 'curitiba', 'porto alegre', 'goiânia'
      ];
      
      for (const city of knownCities) {
        if (addressText.includes(city)) {
          orderData.city = city.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
          break;
        }
      }
      
      // Se não encontrou cidade conhecida, tentar última parte do endereço
      if (!orderData.city) {
        const parts = orderData.address.split(',').map(part => part.trim());
        for (const part of parts.reverse()) {
          if (part && !part.match(/\d+/) && part.length > 2 && !part.match(/^(rua|avenida|av|r)$/i)) {
            orderData.city = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            break;
          }
        }
      }
      
      // Fallback para Volta Redonda
      if (!orderData.city) {
        orderData.city = 'Volta Redonda';
      }
      
      break;
    }
  }

  // Extrair TELEFONE - melhorar regex
  const phonePatterns = [
    /(\d{2})\s*(\d{9})/g,  // 24 999325986
    /(\d{2})\s*(\d{4,5})[\s-]?(\d{4})/g,  // 24 9993-25986 ou 24 99932-5986
    /(\d{10,11})/g  // 24999325986
  ];
  
  for (const pattern of phonePatterns) {
    const matches = allUserText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleanPhone = match.replace(/\D/g, '');
        if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
          orderData.phone = cleanPhone;
          console.log(`[EXTRACT] 📱 Telefone encontrado: ${cleanPhone}`);
          break;
        }
      }
      if (orderData.phone) break;
    }
  }

  // Extrair PAGAMENTO
  if (allUserText.includes('cartão') || allUserText.includes('cartao')) {
    orderData.paymentMethod = 'cartão';
  } else if (allUserText.includes('dinheiro') || allUserText.includes('espécie')) {
    orderData.paymentMethod = 'dinheiro';
  } else if (allUserText.includes('pix')) {
    orderData.paymentMethod = 'pix';
  }

  // Extrair TROCO
  const changeMatch = allUserText.match(/troco.*?(\d+)/i);
  if (changeMatch) {
    orderData.change = changeMatch[1];
  }

  console.log(`[EXTRACT] 📝 Dados extraídos finais:`, orderData);
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

    console.log(`[PEDIDO] 📝 MENSAGEM PREPARADA`);

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
      console.error(`[WHATSAPP] ❌ VARIÁVEIS DE AMBIENTE FALTANDO!`);
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
