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
    scraping: 3
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
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      ...options.headers
    },
    ...options
  };

  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`[FETCH] Tentativa ${i + 1}/${retries + 1} para ${url}`);
      
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
    
    // 1. GERAR QUERY DE BUSCA INTELIGENTE
    const searchQuery = await generateSearchQuery(food, city, state);
    console.log(`[REAL_SEARCH] 🔍 Query gerada: ${searchQuery}`);

    // 2. BUSCAR NO GOOGLE DIRETO (SEM API)
    const googleResults = await searchGoogleDirect(searchQuery);
    
    if (googleResults.length === 0) {
      console.log(`[REAL_SEARCH] ❌ Nenhum resultado no Google`);
      return [];
    }

    console.log(`[REAL_SEARCH] 📊 ${googleResults.length} resultados do Google`);

    // 3. PROCESSAR CADA RESULTADO PARA EXTRAIR WHATSAPP
    const restaurants = [];
    
    for (let i = 0; i < Math.min(googleResults.length, 10); i++) {
      const result = googleResults[i];
      
      try {
        console.log(`[REAL_SEARCH] 🔍 Processando: ${result.title}`);
        
        // Verificar se é relevante para a cidade
        const isRelevant = result.title.toLowerCase().includes(city.toLowerCase()) ||
                          result.snippet.toLowerCase().includes(city.toLowerCase()) ||
                          result.link.toLowerCase().includes(city.toLowerCase());
        
        if (!isRelevant) {
          console.log(`[REAL_SEARCH] ⏭️ Pulando ${result.title} - não relevante para ${city}`);
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

// 🧠 GERAR QUERY DE BUSCA INTELIGENTE
async function generateSearchQuery(food, city, state) {
  try {
    const prompt = `
Crie uma query de busca no Google para encontrar restaurantes REAIS que entregam "${food}" em ${city}, ${state}.

REGRAS:
- Foque em encontrar estabelecimentos COM WhatsApp
- Use termos que tragam resultados locais
- Inclua palavras como "delivery", "entrega", "whatsapp"

EXEMPLOS:
- Para pizza: "pizzaria delivery whatsapp ${city} ${state}"
- Para hambúrguer: "hamburgueria lanchonete whatsapp entrega ${city}"
- Para sushi: "sushi delivery whatsapp ${city}"

Responda APENAS a query de busca, nada mais:
`;

    const result = await model.generateContent(prompt);
    let query = result.response.text().trim();
    
    // Remover aspas se houver
    query = query.replace(/['"]/g, '');
    
    return query;
    
  } catch (error) {
    console.log(`[QUERY] ⚠️ Erro no Gemini, usando fallback`);
    // Fallback manual
    const foodType = food.toLowerCase().includes('pizza') ? 'pizzaria' :
                    food.toLowerCase().includes('hambur') ? 'hamburgueria' :
                    food.toLowerCase().includes('sushi') ? 'sushi' :
                    food.toLowerCase().includes('lanche') ? 'lanchonete' : 
                    food;
    
    return `${foodType} delivery whatsapp entrega ${city} ${state}`;
  }
}

// 🔍 BUSCAR NO GOOGLE DIRETO (SEM PUPPETEER)
async function searchGoogleDirect(query) {
  try {
    console.log(`[GOOGLE] 🚀 Buscando diretamente: ${query}`);
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=15&hl=pt-BR`;
    
    console.log(`[GOOGLE] 🌐 URL: ${searchUrl}`);
    
    const html = await fetchText(searchUrl, {}, 2, CONFIG.timeouts.google);
    
    // Usar regex para extrair resultados (mais confiável que cheerio para Google)
    const results = [];
    
    // Buscar por links e títulos usando regex
    const linkPattern = /<a href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/gi;
    const snippetPattern = /<span[^>]*>([^<]+)<\/span>/gi;
    
    let match;
    while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
      const link = match[1];
      const title = match[2];
      
      // Filtrar links do Google
      if (link && !link.includes('google.com') && !link.includes('youtube.com') && 
          !link.includes('facebook.com') && !link.includes('instagram.com') &&
          title && title.length > 5) {
        
        // Buscar snippet próximo
        let snippet = '';
        const snippetRegex = new RegExp(`${title}[\\s\\S]{0,200}?<span[^>]*>([^<]+)<\/span>`, 'i');
        const snippetMatch = html.match(snippetRegex);
        if (snippetMatch) {
          snippet = snippetMatch[1];
        }
        
        results.push({
          title: title.replace(/&[^;]+;/g, ''), // Remove HTML entities
          link: link.startsWith('/url?q=') ? decodeURIComponent(link.split('&')[0].replace('/url?q=', '')) : link,
          snippet: snippet.replace(/&[^;]+;/g, ''),
          source: "google_direct"
        });
      }
    }
    
    console.log(`[GOOGLE] ✅ ${results.length} resultados extraídos`);
    return results;
    
  } catch (error) {
    console.log(`[GOOGLE] ❌ Erro: ${error.message}`);
    return [];
  }
}

// 📋 EXTRAIR INFORMAÇÕES DO RESTAURANTE
async function extractRestaurantInfo(result, city, state) {
  try {
    const { title, link, snippet } = result;
    
    console.log(`[EXTRACT] 🔍 Extraindo de: ${title}`);

    let whatsapp = null;
    let address = '';
    
    // Primeiro tentar extrair WhatsApp do snippet
    const snippetNumbers = snippet.match(/(\d{2,3})[\s\-]?9?\d{4}[\s\-]?\d{4}/g);
    if (snippetNumbers && snippetNumbers.length > 0) {
      let number = snippetNumbers[0].replace(/\D/g, '');
      if (number.length >= 10) {
        if (number.length === 10) number = '55' + number;
        if (number.length === 11 && !number.startsWith('55')) number = '55' + number;
        whatsapp = number;
        console.log(`[EXTRACT] 📱 WhatsApp do snippet: ${whatsapp}`);
      }
    }
    
    // Se não encontrou no snippet, tentar acessar a página
    if (!whatsapp) {
      try {
        console.log(`[EXTRACT] 🌐 Visitando: ${link}`);
        
        const html = await fetchText(link, {}, 1, CONFIG.timeouts.scraping);
        
        // Usar regex para buscar WhatsApp no HTML (mais rápido que cheerio)
        const whatsappPatterns = [
          /whatsapp[:\s]*(\(?[\d\s\-\+\(\)]{10,15}\)?)/gi,
          /wa\.me\/(\d{10,15})/gi,
          /api\.whatsapp\.com\/send\?phone=(\d{10,15})/gi,
          /(\d{2,3})[\s\-]?9?\d{4}[\s\-]?\d{4}/g // Padrão BR
        ];
        
        const text = html.toLowerCase();
        
        for (const pattern of whatsappPatterns) {
          const matches = text.match(pattern);
          if (matches && matches.length > 0) {
            let number = matches[0].replace(/\D/g, '');
            if (number.length >= 10) {
              // Garantir formato brasileiro
              if (number.length === 10) number = '55' + number;
              if (number.length === 11 && !number.startsWith('55')) number = '55' + number;
              whatsapp = number;
              console.log(`[EXTRACT] 📱 WhatsApp da página: ${whatsapp}`);
              break;
            }
          }
        }
        
        // Buscar endereço
        const addressPatterns = [
          /endere[çc]o[:\s]*(.*?)(?:\.|,|;|<|$)/i,
          /localiza[çc][ãa]o[:\s]*(.*?)(?:\.|,|;|<|$)/i,
          /(rua|avenida|av\.|r\.|estrada|rodovia)[\s\.]+(.*?)(?:\.|,|;|<|$)/i
        ];
        
        for (const pattern of addressPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            address = match[1].trim().substring(0, 100);
            break;
          }
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
    const estimatedInfo = await generateRealisticInfo(title, city, snippet);
    
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

    console.log(`[EXTRACT] ✅ Restaurante completo: ${restaurant.name}`);
    return restaurant;
    
  } catch (error) {
    console.error(`[EXTRACT] ❌ Erro:`, error);
    return null;
  }
}

// 🎯 GERAR INFORMAÇÕES REALISTAS
async function generateRealisticInfo(name, city, snippet) {
  try {
    const prompt = `
Baseado no restaurante "${name}" em ${city}, gere informações REALISTAS:

Contexto: ${snippet}

Responda APENAS um JSON válido:
{
  "rating": 4.2,
  "estimatedTime": "30-40 min",
  "estimatedPrice": "R$ 35-55", 
  "specialty": "Pizza delivery"
}

REGRAS:
- Rating entre 3.8 e 4.8
- Tempo 20-60 min
- Preços brasileiros 2024 realistas
- Specialty baseada no nome
`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    // Extrair JSON
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('JSON inválido');
    
  } catch (error) {
    // Fallback realista
    return {
      rating: (3.8 + Math.random() * 1).toFixed(1),
      estimatedTime: `${20 + Math.floor(Math.random() * 40)}-${40 + Math.floor(Math.random() * 20)} min`,
      estimatedPrice: `R$ ${25 + Math.floor(Math.random() * 50)}-${45 + Math.floor(Math.random() * 40)}`,
      specialty: name.toLowerCase().includes('pizza') ? 'Pizza delivery' :
                name.toLowerCase().includes('hambur') ? 'Hamburgueria' :
                name.toLowerCase().includes('sushi') ? 'Sushi delivery' : 'Delivery'
    };
  }
}
