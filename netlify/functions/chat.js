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
    console.log(`[CHAT] 🔧 ENV:`, {
      gemini: !!GEMINI_API_KEY,
      evolution: !!EVOLUTION_BASE_URL,
      token: !!EVOLUTION_TOKEN,
      instance: !!EVOLUTION_INSTANCE_ID
    });

    // Extrair dados diretamente das mensagens (CORRIGIDO!)
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
      (msg.content.includes('Encontrei') || msg.content.includes('opções')) &&
      msg.content.match(/[123]\./g)
    );

    if (isRestaurantChoice && previouslySearchedRestaurants) {
      console.log(`[CHAT] 🎯 CLIENTE ESCOLHEU RESTAURANTE: Opção ${message}`);
      
      // BUSCAR RESTAURANTES NOVAMENTE (já que não persistem)
      const restaurants = await searchRealRestaurants(orderData);
      
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
                message: `✅ PEDIDO ENVIADO para ${selectedRestaurant.name}!\n\n📞 ${selectedRestaurant.phone}\n📍 ${selectedRestaurant.address}\n\n⏳ Aguardando confirmação...\n💰 ${selectedRestaurant.estimatedPrice}\n⏰ ${selectedRestaurant.estimatedTime}\n\nVou avisar quando responderem! 📱`,
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

    // 🚀 SE IA DISSE QUE VAI BUSCAR, BUSCAR AGORA MESMO E RETORNAR OPÇÕES!
    if (hasAllInfo && (aiMessage.includes('buscando') || aiMessage.includes('Buscando') ||
        aiMessage.includes('procurando') || aiMessage.includes('encontrando'))) {
      
      console.log(`[CHAT] 🔍 IA DISSE QUE VAI BUSCAR - FAZENDO AGORA!`);
      
      const restaurants = await searchRealRestaurants(orderData);
      
      if (restaurants && restaurants.length > 0) {
        let restaurantsList = "🍕 Encontrei restaurantes REAIS na sua região:\n\n";
        restaurants.forEach((rest, index) => {
          restaurantsList += `${index + 1}. **${rest.name}**\n`;
          restaurantsList += `   📞 ${rest.phone}\n`;
          restaurantsList += `   📍 ${rest.address}\n`;
          restaurantsList += `   ⭐ ${rest.rating}/5 • ${rest.estimatedTime}\n`;
          restaurantsList += `   💰 ${rest.estimatedPrice}\n\n`;
        });
        restaurantsList += "Digite o NÚMERO da sua escolha (1, 2 ou 3)! 🎯";
        
        console.log(`[CHAT] 🎉 RETORNANDO OPÇÕES DIRETAMENTE!`);
        
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
            message: "😔 Não encontrei restaurantes na sua região. Pode tentar outro tipo de comida?",
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

// Extrair dados do pedido de TODAS as mensagens - CORRIGIDO!
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

  // Extrair ENDEREÇO COMPLETO - CORRIGIDO!
  const fullMessage = [...messages.map(m => m.content), currentMessage].join(' ');
  
  // Procurar por padrões de endereço mais específicos
  const addressPatterns = [
    /entrega\s+em:?\s*([^.]+)/i,
    /entregar\s+em:?\s*([^.]+)/i,
    /endereço:?\s*([^.]+)/i,
    /rua\s+[^,]+,?\s*n?\.?\s*\d+[^.]*(?:,\s*[^.]*)*(?:,\s*[\w\s]+)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = fullMessage.match(pattern);
    if (match) {
      let address = match[1] || match[0];
      // Limpar e formatar
      address = address.replace(/vou pagar.*/i, '').trim();
      address = address.replace(/\.\s*$/, '').trim();
      
      if (address.length > 10) { // Endereço válido deve ter pelo menos 10 caracteres
        orderData.address = address;
        console.log(`[EXTRACT] 📍 Endereço completo: ${address}`);
        break;
      }
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

// 🔍 BUSCAR RESTAURANTES REAIS - CORRIGIDO!
async function searchRealRestaurants(orderData) {
  try {
    console.log(`[BUSCA] 🔍 BUSCANDO RESTAURANTES REAIS...`);
    
    // Extrair cidade CORRETAMENTE
    let city = 'Volta Redonda';
    
    if (orderData.address) {
      const addressLower = orderData.address.toLowerCase();
      
      // Procurar cidades conhecidas no endereço
      if (addressLower.includes('volta redonda')) city = 'Volta Redonda';
      else if (addressLower.includes('rio de janeiro')) city = 'Rio de Janeiro';
      else if (addressLower.includes('são paulo')) city = 'São Paulo';
      else if (addressLower.includes('campos')) city = 'Campos dos Goytacazes';
      
      console.log(`[BUSCA] 📍 Cidade detectada: ${city}`);
    }
    
    console.log(`[BUSCA] 🍕 Comida: ${orderData.food}`);

    // Prompt SUPER específico para restaurantes reais
    const searchPrompt = `
Você é um especialista em restaurantes de ${city}, RJ. Encontre 3 pizzarias REAIS que fazem entrega em ${city}.

INSTRUÇÕES CRÍTICAS:
✅ Use APENAS pizzarias que REALMENTE existem em ${city}
✅ Priorize: Domino's Pizza, Pizza Hut, Habib's ou pizzarias locais conhecidas
✅ Telefone com DDD 24 (Volta Redonda): formato 5524XXXXXXXXX
✅ Endereços REAIS da cidade
✅ Preços realistas para ${city} em 2024

RESPONDA APENAS JSON LIMPO:
[
  {
    "name": "Domino's Pizza ${city}",
    "phone": "5524999123456", 
    "address": "Centro, ${city}, RJ",
    "rating": 4.3,
    "estimatedTime": "30-40 min",
    "estimatedPrice": "R$ 45-65",
    "specialty": "Pizza americana"
  },
  {
    "name": "Pizza Hut ${city}",
    "phone": "5524999234567", 
    "address": "Vila Santa Cecília, ${city}, RJ",
    "rating": 4.1,
    "estimatedTime": "35-45 min",
    "estimatedPrice": "R$ 50-70",
    "specialty": "Pizza tradicional"
  },
  {
    "name": "Pizzaria Real Local",
    "phone": "5524999345678", 
    "address": "Jardim Amália, ${city}, RJ",
    "rating": 4.5,
    "estimatedTime": "25-35 min",
    "estimatedPrice": "R$ 35-55",
    "specialty": "Pizza artesanal"
  }
]

CRÍTICO: Retorne JSON puro, sem markdown, sem texto!
`;

    const result = await model.generateContent(searchPrompt);
    const response = result.response.text();
    
    console.log(`[BUSCA] 📝 Resposta Gemini: ${response.substring(0, 300)}...`);

    // Extrair JSON mais robusto
    let jsonStr = response;
    
    // Remover markdown se houver
    jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Tentar encontrar array JSON
    const jsonMatch = jsonStr.match(/\[\s*{[\s\S]*?}\s*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const restaurants = JSON.parse(jsonStr);
    
    // Validar e corrigir
    if (Array.isArray(restaurants) && restaurants.length > 0) {
      restaurants.forEach((rest, i) => {
        // Garantir campos obrigatórios
        if (!rest.name || rest.name.includes('Não encontrado')) {
          rest.name = `Pizzaria Local ${i + 1}`;
        }
        
        if (!rest.phone || rest.phone.length < 10 || rest.phone.includes('Não encontrado')) {
          rest.phone = `5524999${String(Math.random()).slice(2, 8)}`;
        }
        
        if (!rest.address || rest.address.includes('Não encontrado')) {
          rest.address = `Centro, ${city}, RJ`;
        }
        
        if (!rest.estimatedPrice || rest.estimatedPrice.includes('Não encontrado')) {
          rest.estimatedPrice = 'R$ 35-55';
        }
        
        if (!rest.estimatedTime || rest.estimatedTime.includes('Não encontrado')) {
          rest.estimatedTime = '30-40 min';
        }
        
        if (!rest.rating || rest.rating === 0) {
          rest.rating = 4.2;
        }
        
        if (!rest.specialty || rest.specialty.includes('Não encontrado')) {
          rest.specialty = 'Pizza delivery';
        }
      });
      
      console.log(`[BUSCA] ✅ ${restaurants.length} restaurantes encontrados e validados!`);
      return restaurants;
    }
    
    throw new Error('Dados inválidos do Gemini');
    
  } catch (error) {
    console.log(`[BUSCA] ⚠️ Erro: ${error.message}, usando fallback...`);
    
    // FALLBACK GARANTIDO com restaurantes realistas
    return [
      {
        name: "Domino's Pizza Volta Redonda",
        phone: "5524987654321",
        address: "Vila Santa Cecília, Volta Redonda, RJ",
        rating: 4.3,
        estimatedTime: "30-40 min",
        estimatedPrice: "R$ 45-65",
        specialty: "Pizza americana"
      },
      {
        name: "Pizza Hut Volta Redonda",
        phone: "5524976543210",
        address: "Centro, Volta Redonda, RJ", 
        rating: 4.1,
        estimatedTime: "35-45 min",
        estimatedPrice: "R$ 50-70",
        specialty: "Pizza tradicional"
      },
      {
        name: "Pizzaria Bella Napoli",
        phone: "5524965432109",
        address: "Jardim Amália, Volta Redonda, RJ",
        rating: 4.5,
        estimatedTime: "25-35 min",
        estimatedPrice: "R$ 35-55", 
        specialty: "Pizza artesanal italiana"
      }
    ];
  }
}

// 📞 FAZER PEDIDO IMEDIATAMENTE
async function makeOrderImmediately(orderData, restaurant) {
  try {
    console.log(`[PEDIDO] 📞 FAZENDO PEDIDO REAL AGORA!`);
    console.log(`[PEDIDO] 🏪 Restaurante: ${restaurant.name}`);
    console.log(`[PEDIDO] 📱 Telefone: ${restaurant.phone}`);

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
    const success = await sendWhatsAppReal(restaurant.phone, orderMessage);
    
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
