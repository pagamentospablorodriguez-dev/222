const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const CONFIG = {
  timeouts: {
    google: 10000,
    scraping: 8000,
    general: 12000
  },
  retries: {
    api: 2,
    scraping: 2
  },
  delays: {
    betweenRetries: 1000,
    betweenRequests: 500
  }
};

// LISTA DE ESTABELECIMENTOS POPULARES POR CATEGORIA (PRIORIDADE)
const POPULAR_ESTABLISHMENTS = {
  pizza: [
    'dominos', "domino's", 'pizza hut', 'telepizza', 'pizza express', 
    'habib\s', 'spoleto', 'ragazzo', 'casa da pizza', 'pizzaria bella',
    'chicago pizza', 'suburbanos pizza', 'fornalha pizzaria', 'verano pizzaria'
  ],
  hamburguer: [
    'mcdonalds', "mcdonald's", 'burger king', 'bobs', 'giraffas', 
    'subway', 'burger', 'lanchonete', 'hamburguer', 'hamburgueria'
  ],
  sushi: [
    'temakeria', 'sushi house', 'tokyo', 'nagoya', 'osaka', 'sushiman', 
    'oriental', 'japonesa', 'china in box', 'sushi'
  ],
  lanche: [
    'subway', 'bobs', 'burger king', 'lanchonete', 'sanduicheria', 
    'fast food', 'snack', 'x-burger', 'x-salada'
  ],
  açaí: [
    'açaí express', 'tropical açaí', 'açaí mania', 'polpa', 'açaiteria'
  ]
};

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
    const { food, city = 'Volta Redonda', state = 'RJ' } = JSON.parse(event.body);

    if (!food) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Tipo de comida é obrigatório' })
      };
    }

    console.log(`[SEARCH] 🔍 Buscando ${food} em ${city}, ${state}`);

    // NOVA ESTRATÉGIA: PRIMEIRO ENCONTRAR ESTABELECIMENTOS, DEPOIS WHATSAPP
    const restaurants = await searchEstablishmentsAndWhatsApp(food, city, state);
    
    if (restaurants.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: `Não encontrei ${food} com WhatsApp em ${city}`
        })
      };
    }

    console.log(`[SEARCH] ✅ ${restaurants.length} restaurantes encontrados`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        restaurants: restaurants.slice(0, 3), // Top 3
        total: restaurants.length
      })
    };

  } catch (error) {
    console.error('❌ Erro na busca:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erro interno do servidor',
        details: error.message 
      })
    };
  }
};

// 🎯 NOVA ESTRATÉGIA: PRIMEIRO ESTABELECIMENTOS, DEPOIS WHATSAPP
async function searchEstablishmentsAndWhatsApp(food, city, state) {
  try {
    console.log(`[NEW_SEARCH] 🎯 NOVA ESTRATÉGIA: Primeiro estabelecimentos, depois WhatsApp`);
    
    // PASSO 1: BUSCAR ESTABELECIMENTOS NA CIDADE
    const establishments = await findEstablishmentsInCity(food, city, state);
    
    if (establishments.length === 0) {
      console.log(`[NEW_SEARCH] ❌ Nenhum estabelecimento encontrado`);
      return [];
    }

    console.log(`[NEW_SEARCH] 📋 ${establishments.length} estabelecimentos encontrados:`);
    establishments.forEach((est, i) => {
      console.log(`[NEW_SEARCH] ${i+1}. ${est.name} (Prioridade: ${est.priority})`);
    });

    // PASSO 2: BUSCAR WHATSAPP PARA CADA ESTABELECIMENTO
    const restaurantsWithWhatsApp = [];

    for (const establishment of establishments) {
      try {
        console.log(`[NEW_SEARCH] 📱 Buscando WhatsApp para: ${establishment.name}`);
        
        const whatsappNumber = await searchWhatsAppForEstablishment(establishment.name, city, state);
        
        if (whatsappNumber) {
          const restaurant = {
            name: establishment.name,
            whatsapp: whatsappNumber,
            phone: whatsappNumber,
            address: establishment.address || `${city}, ${state}`,
            link: establishment.link || '',
            rating: generateRealisticRating(establishment.name),
            estimatedTime: generateRealisticTime(),
            estimatedPrice: generateRealisticPrice(food),
            specialty: generateSpecialty(food)
          };

          restaurantsWithWhatsApp.push(restaurant);
          console.log(`[NEW_SEARCH] ✅ ${establishment.name} - WhatsApp encontrado: ${whatsappNumber}`);
          
          // Parar quando tivermos 3 restaurantes
          if (restaurantsWithWhatsApp.length >= 3) {
            break;
          }
        } else {
          console.log(`[NEW_SEARCH] ❌ ${establishment.name} - WhatsApp não encontrado`);
        }
        
        // Delay entre buscas
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (error) {
        console.log(`[NEW_SEARCH] ⚠️ Erro ao buscar WhatsApp para ${establishment.name}: ${error.message}`);
        continue;
      }
    }

    console.log(`[NEW_SEARCH] 🎉 RESULTADO FINAL: ${restaurantsWithWhatsApp.length} restaurantes com WhatsApp`);
    return restaurantsWithWhatsApp;

  } catch (error) {
    console.error('[NEW_SEARCH] ❌ Erro crítico:', error);
    return [];
  }
}

// 🏪 BUSCAR ESTABELECIMENTOS NA CIDADE (SEM WHATSAPP)
async function findEstablishmentsInCity(food, city, state) {
  try {
    console.log(`[ESTABLISHMENTS] 🏪 Buscando estabelecimentos de ${food} em ${city}`);
    
    // Query focada apenas em encontrar estabelecimentos
    const searchQuery = `${food} restaurante ${city} ${state} delivery`;
    
    const googleResults = await searchGoogleAPI(searchQuery, 15); // Mais resultados
    
    if (googleResults.length === 0) {
      console.log(`[ESTABLISHMENTS] ❌ Nenhum resultado do Google`);
      return [];
    }

    const establishments = [];
    const popularKeywords = POPULAR_ESTABLISHMENTS[food] || [];

    // Processar resultados e dar prioridade aos populares
    for (const result of googleResults) {
      const name = result.title;
      const isRelevant = name.toLowerCase().includes(city.toLowerCase()) ||
                        result.snippet.toLowerCase().includes(city.toLowerCase()) ||
                        result.link.includes('.br');

      if (!isRelevant) continue;

      // Calcular prioridade (populares primeiro)
      let priority = 0;
      const nameLower = name.toLowerCase();
      
      for (let i = 0; i < popularKeywords.length; i++) {
        if (nameLower.includes(popularKeywords[i])) {
          priority = popularKeywords.length - i; // Primeiros da lista têm mais prioridade
          break;
        }
      }

      establishments.push({
        name: name,
        link: result.link,
        snippet: result.snippet,
        priority: priority,
        address: extractAddressFromSnippet(result.snippet, city)
      });
    }

    // Ordenar por prioridade (populares primeiro)
    establishments.sort((a, b) => b.priority - a.priority);

    console.log(`[ESTABLISHMENTS] 📊 ${establishments.length} estabelecimentos processados e ordenados`);
    return establishments.slice(0, 10); // Top 10 para buscar WhatsApp

  } catch (error) {
    console.error('[ESTABLISHMENTS] ❌ Erro:', error);
    return [];
  }
}

// 📱 BUSCAR WHATSAPP ESPECÍFICO PARA UM ESTABELECIMENTO
async function searchWhatsAppForEstablishment(establishmentName, city, state) {
  try {
    console.log(`[WHATSAPP_SEARCH] 📱 Buscando WhatsApp: ${establishmentName}`);
    
    // Queries específicas para WhatsApp
    const whatsappQueries = [
      `"${establishmentName}" whatsapp ${city}`,
      `"${establishmentName}" "whatsapp" ${city} ${state}`,
      `${establishmentName} contato whatsapp ${city}`,
      `${establishmentName} pedidos whatsapp delivery`,
      `site:wa.me ${establishmentName} ${city}`
    ];

    for (const query of whatsappQueries) {
      try {
        console.log(`[WHATSAPP_SEARCH] 🔍 Query: ${query.substring(0, 50)}...`);
        
        const results = await searchGoogleAPI(query, 5);
        
        for (const result of results) {
          // Tentar extrair WhatsApp do snippet primeiro
          let whatsapp = extractWhatsAppFromText(result.snippet);
          
          if (whatsapp) {
            console.log(`[WHATSAPP_SEARCH] 📱 WhatsApp encontrado no snippet: ${whatsapp}`);
            return whatsapp;
          }

          // Se não encontrou no snippet, tentar na página
          if (result.link && !result.link.includes('instagram.com/accounts/')) {
            try {
              const html = await fetchText(result.link, {}, 1, CONFIG.timeouts.scraping);
              whatsapp = extractWhatsAppFromText(html);
              
              if (whatsapp) {
                console.log(`[WHATSAPP_SEARCH] 📱 WhatsApp encontrado na página: ${whatsapp}`);
                return whatsapp;
              }
            } catch (pageError) {
              console.log(`[WHATSAPP_SEARCH] ⚠️ Erro ao acessar página: ${pageError.message}`);
            }
          }
        }
        
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (queryError) {
        console.log(`[WHATSAPP_SEARCH] ⚠️ Erro na query: ${queryError.message}`);
        continue;
      }
    }

    console.log(`[WHATSAPP_SEARCH] ❌ WhatsApp não encontrado para ${establishmentName}`);
    return null;

  } catch (error) {
    console.error(`[WHATSAPP_SEARCH] ❌ Erro crítico:`, error);
    return null;
  }
}

function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

function timeoutPromise(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)
    )
  ]);
}

async function fetchWithRetry(url, options = {}, retries = CONFIG.retries.api, timeout = CONFIG.timeouts.general) {
  const fetchOptions = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      ...options.headers
    },
    ...options
  };

  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`[FETCH] Tentativa ${i + 1}/${retries + 1} para ${url.substring(0, 100)}...`);
      
      const response = await timeoutPromise(
        fetch(url, fetchOptions),
        timeout
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      console.log(`[FETCH] Erro na tentativa ${i + 1}: ${error.message}`);
      
      if (i === retries) {
        throw new Error(`Falha após ${retries + 1} tentativas: ${error.message}`);
      }
      
      await sleep(CONFIG.delays.betweenRetries * (i + 1));
    }
  }
}

async function fetchJSON(url, options = {}, retries = CONFIG.retries.api, timeout = CONFIG.timeouts.general) {
  try {
    const response = await fetchWithRetry(url, options, retries, timeout);
    return await response.json();
  } catch (error) {
    console.log(`[FETCH_JSON] Erro: ${error.message}`);
    throw error;
  }
}

async function fetchText(url, options = {}, retries = CONFIG.retries.scraping, timeout = CONFIG.timeouts.general) {
  try {
    const response = await fetchWithRetry(url, options, retries, timeout);
    return await response.text();
  } catch (error) {
    console.log(`[FETCH_TEXT] Erro: ${error.message}`);
    throw error;
  }
}

// 🔍 BUSCAR NO GOOGLE USANDO API (MELHORADO)
async function searchGoogleAPI(query, numResults = 10) {
  try {
    console.log(`[GOOGLE_API] 🚀 Query: ${query}`);
    
    const googleKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    if (!googleKey || !cx) {
      console.log("[GOOGLE_API] API não configurada, retornando mock");
      return [{
        title: `Restaurante Mock - ${query}`,
        link: "https://example.com",
        snippet: "Restaurante de exemplo para demonstração",
        source: "google_mock"
      }];
    }
    
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${googleKey}&cx=${cx}&num=${numResults}`;
    
    const data = await fetchJSON(url, {}, 1, CONFIG.timeouts.google);
    const items = data.items || [];
    
    console.log(`[GOOGLE_API] ✅ ${items.length} resultados da API`);
    
    const results = [];
    for (const item of items) {
      results.push({
        title: item.title,
        link: item.link,
        snippet: item.snippet || "",
        source: "google_api"
      });
    }
    
    return results;
    
  } catch (error) {
    console.log(`[GOOGLE_API] ❌ Erro: ${error.message}`);
    return [];
  }
}

// 📱 EXTRAIR WHATSAPP DE TEXTO (MELHORADO)
function extractWhatsAppFromText(text) {
  if (!text) return null;
  
  const textLower = text.toLowerCase();
  
  // Padrões de WhatsApp em ordem de prioridade
  const whatsappPatterns = [
    /wa\.me\/(\+?55\d{10,11})/gi,
    /wa\.me\/(\d{12,15})/gi,
    /whatsapp.*?(\+?55\s?\(?\d{2}\)?\s*9?\d{4}[\s-]?\d{4})/gi,
    /whatsapp.*?(\d{2})\s*9?\s*\d{4}[\s-]?\d{4}/gi,
    /contato.*?(\+?55\s?\d{2})\s*9\d{4}[\s-]?\d{4}/gi,
    /pedidos.*?(\+?55\s?\d{2})\s*9\d{4}[\s-]?\d{4}/gi,
    /(\+?55\s?)?\(?(\d{2})\)?\s*9\d{4}[\s-]?\d{4}/g
  ];
  
  for (const pattern of whatsappPatterns) {
    const matches = textLower.match(pattern);
    if (matches && matches.length > 0) {
      // Extrair só os números
      let number = matches[0].replace(/\D/g, '');
      
      if (number.length >= 10 && number.length <= 13) {
        // Garantir formato brasileiro
        if (number.length === 10) number = '55' + number;
        if (number.length === 11 && !number.startsWith('55')) number = '55' + number;
        
        // Validar se é um número brasileiro válido
        if (number.length >= 12 && number.startsWith('55') && 
            (number.charAt(4) === '9' || number.charAt(2) === '9')) {
          console.log(`[EXTRACT] 📱 WhatsApp encontrado: ${number}`);
          return number;
        }
      }
    }
  }
  
  return null;
}

// 📍 EXTRAIR ENDEREÇO DO SNIPPET
function extractAddressFromSnippet(snippet, city) {
  if (!snippet) return `${city}, RJ`;
  
  const addressPatterns = [
    /(?:rua|avenida|av\.?|r\.?)\s+[^,\n]+(?:,?\s*n?\.?\s*\d+)?(?:,\s*[^,\n]+)*/i,
    /endere[çc]o:?\s*([^.\n]+)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = snippet.match(pattern);
    if (match) {
      return match[0].substring(0, 100);
    }
  }
  
  return `${city}, RJ`;
}

// 🎯 GERAR INFORMAÇÕES REALISTAS
function generateRealisticRating(name) {
  const nameLower = name.toLowerCase();
  let rating = 4.0 + (Math.random() * 0.8); // 4.0 - 4.8
  
  if (nameLower.includes('domino') || nameLower.includes('pizza hut')) rating = 4.2 + (Math.random() * 0.4);
  if (nameLower.includes('mcdonald') || nameLower.includes('burger king')) rating = 4.0 + (Math.random() * 0.3);
  
  return rating.toFixed(1);
}

function generateRealisticTime() {
  const minTime = 25 + Math.floor(Math.random() * 15); // 25-40
  const maxTime = minTime + 10 + Math.floor(Math.random() * 15); // +10-25
  return `${minTime}-${maxTime} min`;
}

function generateRealisticPrice(food) {
  let minPrice = 25 + Math.floor(Math.random() * 20); // 25-45
  let maxPrice = minPrice + 15 + Math.floor(Math.random() * 25); // +15-40
  
  if (food.includes('pizza')) {
    minPrice = 35 + Math.floor(Math.random() * 15);
    maxPrice = minPrice + 20 + Math.floor(Math.random() * 20);
  }
  
  return `R$ ${minPrice}-${maxPrice}`;
}

function generateSpecialty(food) {
  if (food.includes('pizza')) return 'Pizza delivery';
  if (food.includes('hambur') || food.includes('burger') || food.includes('lanche')) return 'Hamburgueria';
  if (food.includes('sushi')) return 'Sushi delivery';
  if (food.includes('açaí')) return 'Açaí e sucos';
  return 'Delivery';
}
