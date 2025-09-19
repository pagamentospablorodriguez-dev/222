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

const POST_ORDER_PROMPT = `
Você é o IA Fome e já enviou um pedido para um restaurante com sucesso.

PERSONALIDADE PÓS-PEDIDO:
- Tranquilizador e confiante
- Informativo sobre o processo
- Atencioso às preocupações do cliente
- Proativo em dar atualizações

SITUAÇÃO ATUAL:
- O pedido JÁ FOI ENVIADO para o restaurante
- O cliente pode estar ansioso, com dúvidas, ou agradecendo
- Você deve TRANQUILIZAR e INFORMAR sobre o próximo passo

RESPOSTAS APROPRIADAS:
- Se cliente agradece: "De nada! Fico feliz em ajudar! 😊 O restaurante já está ciente do seu pedido."
- Se cliente pergunta sobre tempo: "O tempo estimado é de X-Y minutos. Vou te avisar quando eles confirmarem!"
- Se cliente tem dúvidas: "Tudo certo! O pedido foi enviado com sucesso e eles vão te responder em breve."
- Se cliente quer cancelar: "Posso tentar cancelar para você. Deixe-me entrar em contato com eles."

REGRAS:
- NUNCA mostre restaurantes novamente
- NUNCA inicie novo processo de coleta de dados
- Seja empático e tranquilizador
- Dê informações sobre o status quando possível
- Se não souber algo específico, seja honesto

LEMBRE-SE: O pedido JÁ foi enviado! Apenas tranquilize e informe o cliente.
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
      context += `Restaurante: ${orderInfo.selectedRestaurant?.name || 'Restaurante selecionado'}\n`;
      context += `Comida: ${orderInfo.food || 'Pedido realizado'}\n`;
      context += `Status: Pedido enviado e aguardando confirmação\n\n`;
      
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

    // Extrair dados diretamente das mensagens
    const extractedData = extractOrderFromMessages(messages, message);
    console.log(`[CHAT] 📊 Dados extraídos:`, extractedData);

    // Verificar se temos todas as informações OBRIGATÓRIAS
    const hasAllInfo = !!(extractedData.food && 
                         extractedData.address && 
                         extractedData.phone && 
                         extractedData.paymentMethod &&
                         (extractedData.paymentMethod !== 'dinheiro' || extractedData.change));

    console.log(`[CHAT] ✅ Info completa: ${hasAllInfo}`);
    console.log(`[CHAT] 🔍 Detalhes:`, {
      food: !!extractedData.food,
      address: !!extractedData.address,
      phone: !!extractedData.phone,
      payment: !!extractedData.paymentMethod
    });

    // 🔥 DETECÇÃO: Se cliente escolheu restaurante (1, 2 ou 3) E não estava em estado order_sent
    const isRestaurantChoice = /^[123]$/.test(message.trim());
    const previouslySearchedRestaurants = messages.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('Encontrei') || msg.content.includes('restaurantes REAIS')) &&
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
          const orderSent = await makeOrderImmediately(extractedData, selectedRestaurant);
          
          if (orderSent) {
            // 🆕 ATUALIZAR ESTADO DA SESSÃO
            sessionStates.set(sessionId, 'order_sent');
            
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
    if (hasAllInfo && currentState !== 'order_sent') {
      console.log(`[CHAT] 🔍 TODAS INFORMAÇÕES COLETADAS - BUSCANDO RESTAURANTES AUTOMATICAMENTE!`);
      
      const restaurants = await searchRealRestaurantsAPI(extractedData);
      
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
    context += `Comida: ${extractedData.food || 'Não informado'}\n`;
    context += `Endereço: ${extractedData.address || 'Não informado'}\n`;
    context += `Cidade: ${extractedData.city || 'Não informado'}\n`;
    context += `WhatsApp: ${extractedData.phone || 'Não informado'}\n`;
    context += `Pagamento: ${extractedData.paymentMethod || 'Não informado'}\n`;
    context += `Troco: ${extractedData.change || 'Não informado'}\n\n`;
    
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
async function searchRealRestaurantsAPI(extractedData) {
  try {
    console.log(`[API] 🔍 BUSCANDO VIA API REAL...`);
    console.log(`[API] 📊 OrderData:`, extractedData);
    
    // Usar a cidade já extraída ou fallback
    const city = extractedData.city || 'Volta Redonda';
    
    console.log(`[API] 📍 Cidade para busca: ${city}`);
    console.log(`[API] 🍕 Comida original: ${extractedData.food}`);
    console.log(`[API] 🍕 Comida limpa: ${extractedData.foodType}`);
    
    // Chamar nossa API de busca INTERNA (mesma instância)
    const apiUrl = `${process.env.URL || 'https://iafome.netlify.app'}/.netlify/functions/search-restaurants`;
    
    console.log(`[API] 🌐 Chamando: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        food: extractedData.foodType || 'pizza', // USAR TIPO LIMPO
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
  // Combinar APENAS mensagens do usuário
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');
  
  const allUserText = `${userMessages} ${currentMessage}`.toLowerCase();
  
  console.log(`[EXTRACT] 🔍 Texto completo do usuário: ${allUserText.substring(0, 200)}...`);
  
  const extractedData = {
    food: null,
    foodType: null, // NOVO: tipo limpo de comida
    address: null,
    city: null,
    phone: null,
    paymentMethod: null,
    change: null
  };

  // Extrair COMIDA - MELHORADO para extrair tipo correto
  const foodKeywords = [
    { keyword: 'pizza', type: 'pizza' },
    { keyword: 'hamburguer', type: 'hamburguer' },
    { keyword: 'hamburger', type: 'hamburguer' },
    { keyword: 'sushi', type: 'sushi' },
    { keyword: 'lanche', type: 'lanche' },
    { keyword: 'combo', type: 'lanche' },
    { keyword: 'sanduiche', type: 'lanche' },
    { keyword: 'pastel', type: 'pastel' },
    { keyword: 'açaí', type: 'açaí' }
  ];
  
  for (const { keyword, type } of foodKeywords) {
    if (allUserText.includes(keyword)) {
      // Buscar a mensagem que contém a comida
      const userMessagesWithCurrent = [...messages.filter(msg => msg.role === 'user').map(m => m.content), currentMessage];
      
      for (const msg of userMessagesWithCurrent) {
        if (msg.toLowerCase().includes(keyword)) {
          extractedData.food = msg; // Mensagem completa
          extractedData.foodType = type; // Tipo limpo
          console.log(`[EXTRACT] 🍕 Comida encontrada: ${keyword} -> ${type}`);
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
    /para\s+entregar\s+em\s+([^.\n]+)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = allUserText.match(pattern);
    if (match) {
      extractedData.address = match[0];
      
      // Extrair cidade do endereço - MELHORADO
      const addressText = match[0].toLowerCase();
      
      // Procurar por cidades conhecidas
      const knownCities = [
        'volta redonda', 'rio de janeiro', 'niterói', 'são paulo', 
        'belo horizonte', 'brasília', 'salvador', 'fortaleza',
        'recife', 'curitiba', 'porto alegre', 'goiânia'
      ];
      
      for (const city of knownCities) {
        if (addressText.includes(city)) {
          extractedData.city = city.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
          break;
        }
      }
      
      // Se não encontrou cidade conhecida, tentar última parte LIMPA do endereço
      if (!extractedData.city) {
        const cleanAddress = extractedData.address.replace(/para pagar no cartão|vou pagar no cartão/gi, '');
        const parts = cleanAddress.split(',').map(part => part.trim());
        
        for (const part of parts.reverse()) {
          if (part && 
              !part.match(/\d+/) && 
              part.length > 2 && 
              !part.match(/^(rua|avenida|av|r|n|jardim)$/i) &&
              !part.includes('pagar') &&
              !part.includes('cartão')) {
            extractedData.city = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            break;
          }
        }
      }
      
      // Fallback para Volta Redonda
      if (!extractedData.city) {
        extractedData.city = 'Volta Redonda';
      }
      
      break;
    }
  }

  // Extrair TELEFONE - MELHORADO
  const phonePatterns = [
    /(\d{2})\s+(\d{9})/g,  // 24 999325986
    /(\d{2})\s+(\d{4,5})[\s-]?(\d{4})/g,  // 24 9993-25986 ou 24 99932-5986
    /(\d{10,11})(?!\d)/g  // 24999325986 (não parte de número maior)
  ];
  
  for (const pattern of phonePatterns) {
    const matches = allUserText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleanPhone = match.replace(/\D/g, '');
        if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
          extractedData.phone = cleanPhone;
          console.log(`[EXTRACT] 📱 Telefone encontrado: ${cleanPhone}`);
          break;
        }
      }
      if (extractedData.phone) break;
    }
  }

  // Extrair PAGAMENTO
  if (allUserText.includes('cartão') || allUserText.includes('cartao')) {
    extractedData.paymentMethod = 'cartão';
  } else if (allUserText.includes('dinheiro') || allUserText.includes('espécie')) {
    extractedData.paymentMethod = 'dinheiro';
  } else if (allUserText.includes('pix')) {
    extractedData.paymentMethod = 'pix';
  }

  // Extrair TROCO
  const changeMatch = allUserText.match(/troco.*?(\d+)/i);
  if (changeMatch) {
    extractedData.change = changeMatch[1];
  }

  console.log(`[EXTRACT] 📝 Dados extraídos finais:`, extractedData);
  return extractedData;
}

// 📞 FAZER PEDIDO IMEDIATAMENTE
async function makeOrderImmediately(extractedData, restaurant) {
  try {
    console.log(`[PEDIDO] 📞 FAZENDO PEDIDO REAL AGORA!`);
    console.log(`[PEDIDO] 🏪 Restaurante: ${restaurant.name}`);
    console.log(`[PEDIDO] 📱 WhatsApp: ${restaurant.whatsapp}`);

    // Limpar endereço para pedido
    let cleanAddress = extractedData.address;
    if (cleanAddress) {
      cleanAddress = cleanAddress
        .replace(/r em /gi, '')
        .replace(/para pagar no cartão|vou pagar no cartão/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Criar mensagem realista
    const orderMessage = `Oi, tudo bem? Gostaria de fazer um pedido para entrega: ${extractedData.food}, endereço: ${cleanAddress}, forma de pagamento: ${extractedData.paymentMethod}${extractedData.change ? ` (Troco para R$ ${extractedData.change})` : ''}

Poderiam me confirmar o valor total e o tempo de entrega por favor? Obrigado! 🙏`;

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
