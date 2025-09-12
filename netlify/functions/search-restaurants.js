const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const CONFIG = {
  timeouts: {
    google: 8000,
    scraping: 6000,
    general: 10000
  },
  retries: {
    api: 2,
    scraping: 2
  },
  delays: {
    betweenRetries: 500,
    betweenRequests: 300
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

    // BUSCAR RESTAURANTES REAIS
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

async function fetchText(url, options = {}, retries = CONFIG.retries.scraping, timeout = CONFIG.timeouts.general) {
  try {
    const response = await fetchWithRetry(url, options, retries, timeout);
    return await response.text();
  } catch (error) {
    console.log(`[FETCH_TEXT] Erro: ${error.message}`);
    throw error;
  }
}

// 🔍 BUSCAR RESTAURANTES REAIS NO GOOGLE
async function searchRealRestaurants(food, city, state) {
  try {
    console.log(`[REAL_SEARCH] 🔍 Iniciando busca real para ${food} em ${city}`);
    
    // 1. CRIAR QUERY SIMPLES E EFICAZ
    const searchQuery = `${food} delivery whatsapp ${city} ${state}`;
    console.log(`[REAL_SEARCH] 🔍 Query: ${searchQuery}`);

    // 2. BUSCAR NO GOOGLE DIRETO
    const googleResults = await searchGoogleDirect(searchQuery);
    
    if (googleResults.length === 0) {
      console.log(`[REAL_SEARCH] ❌ Nenhum resultado no Google`);
      return [];
    }

    console.log(`[REAL_SEARCH] 📊 ${googleResults.length} resultados do Google`);

    // 3. PROCESSAR CADA RESULTADO PARA EXTRAIR WHATSAPP
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

        // Extrair informações do resultado
        const restaurant = await extractRestaurantInfo(result, city, state);
        
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

// 🔍 BUSCAR NO GOOGLE DIRETO - CORRIGIDO
async function searchGoogleDirect(query) {
  try {
    console.log(`[GOOGLE] 🚀 Buscando: ${query}`);
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=pt-BR&gl=br`;
    
    console.log(`[GOOGLE] 🌐 URL: ${searchUrl}`);
    
    const html = await fetchText(searchUrl, {}, 2, CONFIG.timeouts.google);
    
    console.log(`[GOOGLE] 📄 HTML recebido: ${html.length} caracteres`);
    
    // USAR REGEX MAIS SIMPLES E EFICAZ
    const results = [];
    
    // Procurar por divs de resultados do Google
    const resultRegex = /<div[^>]*class="[^"]*g[^"]*"[^>]*>[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/h3>[\s\S]*?<span[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/gi;
    
    let match;
    let matchCount = 0;
    
    while ((match = resultRegex.exec(html)) !== null && matchCount < 8) {
      const link = match[1];
      const title = match[2];
      const snippet = match[3] || '';
      
      // Filtrar links inúteis
      if (link && 
          !link.includes('google.com') && 
          !link.includes('youtube.com') && 
          !link.includes('facebook.com/tr') &&
          !link.includes('instagram.com') &&
          !link.startsWith('/search') &&
          title && title.length > 5) {
        
        // Limpar link se começar com /url?q=
        let cleanLink = link;
        if (link.startsWith('/url?q=')) {
          cleanLink = decodeURIComponent(link.split('&')[0].replace('/url?q=', ''));
        }
        
        results.push({
          title: title.replace(/&[^;]+;/g, '').trim(),
          link: cleanLink,
          snippet: snippet.replace(/&[^;]+;/g, '').trim(),
          source: "google_direct"
        });
        
        matchCount++;
        console.log(`[GOOGLE] ✅ Resultado ${matchCount}: ${title.substring(0, 50)}...`);
      }
    }
    
    // Se não encontrou com regex complexa, usar regex mais simples
    if (results.length === 0) {
      console.log(`[GOOGLE] 🔄 Tentando regex alternativa...`);
      
      const simpleRegex = /<a[^>]*href="([^"]+)"[^>]*><h3[^>]*>([^<]+)<\/h3><\/a>/gi;
      
      while ((match = simpleRegex.exec(html)) !== null && results.length < 5) {
        const link = match[1];
        const title = match[2];
        
        if (link && 
            !link.includes('google.com') && 
            !link.includes('youtube.com') && 
            title && title.length > 5) {
          
          results.push({
            title: title.replace(/&[^;]+;/g, '').trim(),
            link: link.startsWith('/url?q=') ? decodeURIComponent(link.split('&')[0].replace('/url?q=', '')) : link,
            snippet: '',
            source: "google_simple"
          });
          
          console.log(`[GOOGLE] ✅ Resultado simples: ${title.substring(0, 50)}...`);
        }
      }
    }
    
    console.log(`[GOOGLE] ✅ ${results.length} resultados extraídos`);
    return results;
    
  } catch (error) {
    console.log(`[GOOGLE] ❌ Erro: ${error.message}`);
    return [];
  }
}

// 📋 EXTRAIR INFORMAÇÕES DO RESTAURANTE - OTIMIZADO
async function extractRestaurantInfo(result, city, state) {
  try {
    const { title, link, snippet } = result;
    
    console.log(`[EXTRACT] 🔍 Extraindo: ${title}`);

    let whatsapp = null;
    let address = '';
    
    // 1. PRIMEIRO tentar extrair WhatsApp do snippet
    if (snippet) {
      const snippetWhatsapp = extractWhatsAppFromText(snippet);
      if (snippetWhatsapp) {
        whatsapp = snippetWhatsapp;
        console.log(`[EXTRACT] 📱 WhatsApp do snippet: ${whatsapp}`);
      }
    }
    
    // 2. Se não encontrou no snippet, tentar acessar a página (com timeout menor)
    if (!whatsapp && link) {
      try {
        console.log(`[EXTRACT] 🌐 Visitando: ${link.substring(0, 50)}...`);
        
        const html = await fetchText(link, {}, 1, CONFIG.timeouts.scraping);
        
        // Usar regex para buscar WhatsApp no HTML (mais rápido que cheerio)
        whatsapp = extractWhatsAppFromText(html);
        
        if (whatsapp) {
          console.log(`[EXTRACT] 📱 WhatsApp da página: ${whatsapp}`);
        }
        
        // Buscar endereço básico
        const addressMatch = html.toLowerCase().match(/(rua|avenida|av\.)\s+[^<\n]{10,50}/i);
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

// 📱 EXTRAIR WHATSAPP DE TEXTO
function extractWhatsAppFromText(text) {
  if (!text) return null;
  
  const textLower = text.toLowerCase();
  
  // Padrões de WhatsApp em ordem de prioridade
  const whatsappPatterns = [
    /wa\.me\/(\d{12,15})/gi,
    /whatsapp.*?(\d{2})\s*9?\s*\d{4}[\s-]?\d{4}/gi,
    /whatsapp.*?(\(?\d{2}\)?\s*9?\d{4}[\s-]?\d{4})/gi,
    /contato.*?(\d{2})\s*9\d{4}[\s-]?\d{4}/gi,
    /pedidos.*?(\d{2})\s*9\d{4}[\s-]?\d{4}/gi,
    /(\d{2})\s*9\d{4}[\s-]?\d{4}/g
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
        if (number.length === 13 && number.startsWith('55') && 
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
