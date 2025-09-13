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

    // BUSCAR RESTAURANTES USANDO GOOGLE CUSTOM SEARCH API
    const restaurants = await searchRealRestaurants(food, city, state);
    
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

// 🔍 BUSCAR RESTAURANTES USANDO GOOGLE CUSTOM SEARCH API (IGUAL AO CÓDIGO ANTIGO)
async function searchRealRestaurants(food, city, state) {
  try {
    console.log(`[REAL_SEARCH] 🔍 Iniciando busca real para ${food} em ${city}`);
    
    // 1. USAR GOOGLE CUSTOM SEARCH API
    const googleResults = await searchGoogleAPI(food, city, state);
    
    if (googleResults.length === 0) {
      console.log(`[REAL_SEARCH] ❌ Nenhum resultado no Google API`);
      return [];
    }

    console.log(`[REAL_SEARCH] 📊 ${googleResults.length} resultados da API do Google`);

    // 2. PROCESSAR CADA RESULTADO PARA EXTRAIR WHATSAPP
    const restaurants = [];
    
    for (let i = 0; i < Math.min(googleResults.length, 8); i++) {
      const result = googleResults[i];
      
      try {
        console.log(`[REAL_SEARCH] 🔍 Processando: ${result.title}`);
        
        // Verificar se é relevante para a cidade
        const isRelevant = result.title.toLowerCase().includes(city.toLowerCase()) ||
                          result.snippet.toLowerCase().includes(city.toLowerCase()) ||
                          result.link.toLowerCase().includes(city.toLowerCase()) ||
                          result.link.includes('.br'); // Sites brasileiros
        
        if (!isRelevant) {
          console.log(`[REAL_SEARCH] ⏭️ Pulando ${result.title} - não relevante`);
          continue;
        }

        // Extrair informações do restaurante usando regex simples
        const restaurant = await extractRestaurantInfoSimple(result, city, state);
        
        if (restaurant && restaurant.whatsapp) {
          restaurants.push(restaurant);
          console.log(`[REAL_SEARCH] ✅ Adicionado: ${restaurant.name}`);
          
          // Parar se já temos 3 restaurantes
          if (restaurants.length >= 3) break;
        }
        
        // Delay entre processamentos
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (error) {
        console.log(`[REAL_SEARCH] ⚠️ Erro ao processar ${result.title}: ${error.message}`);
        continue;
      }
    }

    console.log(`[REAL_SEARCH] ✅ ${restaurants.length} restaurantes com WhatsApp encontrados`);
    return restaurants;

  } catch (error) {
    console.error('[REAL_SEARCH] ❌ Erro crítico:', error);
    return [];
  }
}

// 🔍 BUSCAR NO GOOGLE USANDO API (IGUAL AO CÓDIGO ANTIGO)
async function searchGoogleAPI(food, city, state) {
  try {
    console.log(`[GOOGLE_API] 🚀 Buscando: ${food} em ${city}`);
    
    const googleKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    if (!googleKey || !cx) {
      console.log("[GOOGLE_API] API não configurada, retornando mock");
      return [{
        title: `Restaurante ${food} - ${city}`,
        link: "https://example.com",
        snippet: "Restaurante de exemplo para demonstração",
        source: "google_mock"
      }];
    }
    
    // Query focada em restaurantes com WhatsApp
    const searchQuery = `${food} restaurante delivery whatsapp ${city} ${state}`;
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(searchQuery)}&key=${googleKey}&cx=${cx}&num=10`;
    
    console.log(`[GOOGLE_API] 🌐 URL: ${url}`);
    
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

// 📋 EXTRAIR INFORMAÇÕES DO RESTAURANTE SEM CHEERIO (MAIS SIMPLES)
async function extractRestaurantInfoSimple(result, city, state) {
  try {
    const { title, link, snippet } = result;
    
    console.log(`[EXTRACT] 🔍 Extraindo: ${title}`);

    let whatsapp = null;
    let address = '';
    let pageText = '';
    
    // 1. PRIMEIRO tentar extrair WhatsApp do snippet
    if (snippet) {
      const snippetWhatsapp = extractWhatsAppFromText(snippet);
      if (snippetWhatsapp) {
        whatsapp = snippetWhatsapp;
        console.log(`[EXTRACT] 📱 WhatsApp do snippet: ${whatsapp}`);
      }
    }
    
    // 2. Se não encontrou no snippet, tentar acessar a página
    if (!whatsapp && link) {
      try {
        console.log(`[EXTRACT] 🌐 Visitando: ${link.substring(0, 50)}...`);
        
        const html = await fetchText(link, {}, 1, CONFIG.timeouts.scraping);
        
        // Extrair texto da página usando regex simples
        pageText = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .substring(0, 3000);
        
        // Buscar WhatsApp no texto da página
        whatsapp = extractWhatsAppFromText(pageText);
        
        if (whatsapp) {
          console.log(`[EXTRACT] 📱 WhatsApp da página: ${whatsapp}`);
        }
        
        // Buscar endereço usando regex
        const addressMatch = pageText.toLowerCase().match(/(rua|avenida|av\.)\s+[^<\n]{10,50}/i);
        if (addressMatch) {
          address = addressMatch[0].substring(0, 80);
        }
        
      } catch (pageError) {
        console.log(`[EXTRACT] ⚠️ Erro ao visitar página: ${pageError.message}`);
      }
    }

    // Se AINDA não encontrou WhatsApp, pular este restaurante
    if (!whatsapp) {
      console.log(`[EXTRACT] ❌ Sem WhatsApp: ${title}`);
      return null;
    }

    // Gerar informações estimadas realistas
    const estimatedInfo = generateRealisticInfoSync(title, city);
    
    const restaurant = {
      name: title,
      whatsapp: whatsapp,
      phone: whatsapp,
      address: address || `${city}, ${state}`,
      link: link,
      rating: estimatedInfo.rating,
      estimatedTime: estimatedInfo.estimatedTime,
      estimatedPrice: estimatedInfo.estimatedPrice,
      specialty: estimatedInfo.specialty
    };

    console.log(`[EXTRACT] ✅ Restaurante OK: ${restaurant.name}`);
    return restaurant;
    
  } catch (error) {
    console.error(`[EXTRACT] ❌ Erro:`, error);
    return null;
  }
}

// 📱 EXTRAIR WHATSAPP DE TEXTO (MELHORADO)
function extractWhatsAppFromText(text) {
  if (!text) return null;
  
  const textLower = text.toLowerCase();
  
  // Padrões de WhatsApp em ordem de prioridade (incluindo +55)
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

// 🎯 GERAR INFORMAÇÕES REALISTAS SEM IA (MAIS RÁPIDO)
function generateRealisticInfoSync(name, city) {
  const nameLower = name.toLowerCase();
  
  // Rating baseado no nome/tipo
  let rating = 4.0 + (Math.random() * 0.8); // 4.0 - 4.8
  
  if (nameLower.includes('domino') || nameLower.includes('pizza hut')) rating = 4.2 + (Math.random() * 0.4);
  if (nameLower.includes('mcdonald') || nameLower.includes('burger king')) rating = 4.0 + (Math.random() * 0.3);
  
  // Tempo baseado no tipo
  let minTime = 25 + Math.floor(Math.random() * 15); // 25-40
  let maxTime = minTime + 10 + Math.floor(Math.random() * 15); // +10-25
  
  // Preço baseado no tipo
  let minPrice = 25 + Math.floor(Math.random() * 20); // 25-45
  let maxPrice = minPrice + 15 + Math.floor(Math.random() * 25); // +15-40
  
  if (nameLower.includes('pizza')) {
    minPrice = 35 + Math.floor(Math.random() * 15);
    maxPrice = minPrice + 20 + Math.floor(Math.random() * 20);
  }
  
  // Especialidade
  let specialty = 'Delivery';
  if (nameLower.includes('pizza')) specialty = 'Pizza delivery';
  else if (nameLower.includes('hambur') || nameLower.includes('burger') || nameLower.includes('lanche')) specialty = 'Hamburgueria';
  else if (nameLower.includes('sushi')) specialty = 'Sushi delivery';
  else if (nameLower.includes('açaí')) specialty = 'Açaí e sucos';
  
  return {
    rating: rating.toFixed(1),
    estimatedTime: `${minTime}-${maxTime} min`,
    estimatedPrice: `R$ ${minPrice}-${maxPrice}`,
    specialty: specialty
  };
}
