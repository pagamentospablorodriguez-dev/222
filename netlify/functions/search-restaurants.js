const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

    // 1. GERAR QUERY DE BUSCA INTELIGENTE
    const searchQuery = await generateSearchQuery(food, city, state);
    console.log(`[SEARCH] 🔍 Query gerada: ${searchQuery}`);

    // 2. BUSCAR NO GOOGLE
    const restaurants = await searchGoogleRestaurants(searchQuery, city, state);
    
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

// 🔍 BUSCAR RESTAURANTES NO GOOGLE
async function searchGoogleRestaurants(query, city, state) {
  let browser;
  
  try {
    console.log(`[GOOGLE] 🚀 Iniciando busca: ${query}`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // User agent realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Fazer a busca
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    console.log(`[GOOGLE] 🌐 URL: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Aguardar resultados carregarem
    await page.waitForTimeout(2000);

    // Extrair resultados
    const results = await page.evaluate(() => {
      const restaurants = [];
      
      // Buscar por diferentes seletores de resultados do Google
      const resultSelectors = [
        'div[data-ved] h3',
        '.g h3',
        '[data-header-feature] h3',
        'div.g div[data-ved] h3'
      ];
      
      let elements = [];
      for (const selector of resultSelectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) break;
      }
      
      console.log(`Encontrados ${elements.length} elementos`);
      
      elements.forEach((element, index) => {
        if (index >= 15) return; // Máximo 15 resultados
        
        try {
          const titleElement = element;
          const linkElement = element.closest('a') || element.parentElement.querySelector('a');
          const containerElement = element.closest('.g') || element.closest('[data-ved]');
          
          const title = titleElement?.textContent?.trim();
          const link = linkElement?.href;
          
          if (title && link && !link.includes('google.com')) {
            // Extrair snippet/descrição
            let snippet = '';
            if (containerElement) {
              const snippetEl = containerElement.querySelector('span:not([class])') || 
                               containerElement.querySelector('.st') ||
                               containerElement.querySelector('[data-sncf]');
              snippet = snippetEl?.textContent?.trim() || '';
            }
            
            restaurants.push({
              title,
              link,
              snippet,
              index
            });
          }
        } catch (e) {
          console.error(`Erro ao processar elemento ${index}:`, e);
        }
      });
      
      return restaurants;
    });

    console.log(`[GOOGLE] 📊 ${results.length} resultados brutos encontrados`);
    
    if (results.length === 0) {
      throw new Error('Nenhum resultado encontrado no Google');
    }

    // Processar cada resultado para extrair informações
    const processedRestaurants = [];
    
    for (let i = 0; i < Math.min(results.length, 10); i++) {
      const result = results[i];
      
      try {
        console.log(`[GOOGLE] 🔍 Processando: ${result.title}`);
        
        // Extrair informações do resultado
        const restaurant = await extractRestaurantInfo(result, page, city, state);
        
        if (restaurant && restaurant.whatsapp) {
          processedRestaurants.push(restaurant);
          console.log(`[GOOGLE] ✅ Adicionado: ${restaurant.name}`);
        }
        
        // Delay entre processamentos
        await page.waitForTimeout(1000);
        
      } catch (error) {
        console.log(`[GOOGLE] ⚠️ Erro ao processar ${result.title}: ${error.message}`);
        continue;
      }
    }

    return processedRestaurants;

  } catch (error) {
    console.error('[GOOGLE] ❌ Erro crítico:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 📋 EXTRAIR INFORMAÇÕES DO RESTAURANTE
async function extractRestaurantInfo(result, page, city, state) {
  try {
    const { title, link, snippet } = result;
    
    // Verificar se é relevante para a cidade
    const isRelevant = title.toLowerCase().includes(city.toLowerCase()) ||
                      snippet.toLowerCase().includes(city.toLowerCase()) ||
                      link.toLowerCase().includes(city.toLowerCase());
    
    if (!isRelevant) {
      console.log(`[EXTRACT] ⏭️ Pulando ${title} - não relevante para ${city}`);
      return null;
    }

    console.log(`[EXTRACT] 🔍 Extraindo de: ${title}`);

    // Tentar visitar a página para buscar WhatsApp
    let whatsapp = null;
    let address = '';
    let phone = '';
    
    try {
      console.log(`[EXTRACT] 🌐 Visitando: ${link}`);
      
      await page.goto(link, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      await page.waitForTimeout(2000);
      
      // Buscar WhatsApp na página
      const pageData = await page.evaluate(() => {
        const text = document.body.textContent.toLowerCase();
        const html = document.body.innerHTML;
        
        // Buscar números de WhatsApp
        const whatsappPatterns = [
          /whatsapp[:\s]*(\(?[\d\s\-\+\(\)]{10,15}\)?)/gi,
          /wa\.me\/(\d{10,15})/gi,
          /api\.whatsapp\.com\/send\?phone=(\d{10,15})/gi,
          /(\d{2,3})[\s\-]?9?\d{4}[\s\-]?\d{4}/g // Padrão BR
        ];
        
        let whatsapp = null;
        for (const pattern of whatsappPatterns) {
          const matches = text.match(pattern) || html.match(pattern);
          if (matches && matches.length > 0) {
            let number = matches[0].replace(/\D/g, '');
            if (number.length >= 10) {
              // Garantir formato brasileiro
              if (number.length === 10) number = '55' + number;
              if (number.length === 11 && !number.startsWith('55')) number = '55' + number;
              whatsapp = number;
              break;
            }
          }
        }
        
        // Buscar endereço
        let address = '';
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
        
        return { whatsapp, address, text: text.substring(0, 500) };
      });
      
      whatsapp = pageData.whatsapp;
      address = pageData.address;
      
    } catch (pageError) {
      console.log(`[EXTRACT] ⚠️ Erro ao visitar página: ${pageError.message}`);
      
      // Tentar extrair do snippet
      const snippetNumbers = snippet.match(/(\d{2,3})[\s\-]?9?\d{4}[\s\-]?\d{4}/g);
      if (snippetNumbers && snippetNumbers.length > 0) {
        let number = snippetNumbers[0].replace(/\D/g, '');
        if (number.length >= 10) {
          if (number.length === 10) number = '55' + number;
          if (number.length === 11 && !number.startsWith('55')) number = '55' + number;
          whatsapp = number;
        }
      }
    }

    // Se não encontrou WhatsApp, pular
    if (!whatsapp) {
      console.log(`[EXTRACT] ❌ Sem WhatsApp: ${title}`);
      return null;
    }

    // Gerar informações estimadas realistas usando IA
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
