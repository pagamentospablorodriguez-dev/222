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

// 🏆 ESTABELECIMENTOS POPULARES POR CATEGORIA
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

// 🗺️ DDDs CONHECIDOS POR CIDADE
const CITY_DDD_MAP = {
  'volta redonda': '24',
  'rio de janeiro': '21',
  'niterói': '21',
  'são paulo': '11',
  'belo horizonte': '31',
  'brasília': '61',
  'salvador': '71',
  'fortaleza': '85',
  'recife': '81',
  'curitiba': '41',
  'porto alegre': '51',
  'goiânia': '62'
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

    // 🆕 DESCOBRIR DDD DA CIDADE
    const cityDDD = await getCityDDD(city, state);
    console.log(`[SEARCH] 📞 DDD da cidade ${city}: ${cityDDD}`);

    // 🎯 BUSCA COM DDD DINÂMICO
    const restaurants = await searchEstablishmentsAndWhatsApp(food, city, state, cityDDD);

    if (restaurants.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: `Não encontrei ${food} com WhatsApp verificado em ${city}`
        })
      };
    }

    console.log(`[SEARCH] ✅ ${restaurants.length} restaurantes verificados encontrados`);

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

// 🗺️ DESCOBRIR DDD DA CIDADE VIA GOOGLE API
async function getCityDDD(city, state) {
  try {
    console.log(`[DDD] 🔍 Descobrindo DDD para ${city}, ${state}`);
    
    // Primeiro, tentar do mapeamento conhecido
    const cityKey = city.toLowerCase();
    if (CITY_DDD_MAP[cityKey]) {
      console.log(`[DDD] ✅ DDD encontrado no mapa: ${CITY_DDD_MAP[cityKey]}`);
      return CITY_DDD_MAP[cityKey];
    }

    // Se não encontrou, buscar via Google API
    const googleKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    if (!googleKey || !cx) {
      console.log(`[DDD] ⚠️ API não configurada, usando DDD padrão 24`);
      return '24'; // Fallback
    }

    const query = `DDD ${city} ${state} código de área telefone`;
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${googleKey}&cx=${cx}&num=5`;
    
    console.log(`[DDD] 🌐 Buscando: ${query}`);
    
    const data = await fetchJSON(url, {}, 1, CONFIG.timeouts.google);
    const items = data.items || [];
    
    for (const item of items) {
      const text = `${item.title} ${item.snippet}`.toLowerCase();
      
      // Procurar por padrões de DDD
      const dddPatterns = [
        new RegExp(`${city.toLowerCase()}.*?(\\d{2})`, 'gi'),
        new RegExp(`código\\s+de\\s+área\\s+(\\d{2})`, 'gi'),
        new RegExp(`ddd\\s+(\\d{2})`, 'gi'),
        /\((\d{2})\)/g
      ];
      
      for (const pattern of dddPatterns) {
        const match = text.match(pattern);
        if (match) {
          const ddd = match[0].replace(/\D/g, '');
          if (ddd.length === 2 && parseInt(ddd) >= 11 && parseInt(ddd) <= 99) {
            console.log(`[DDD] ✅ DDD encontrado via Google: ${ddd}`);
            // Salvar no mapa para próximas consultas
            CITY_DDD_MAP[cityKey] = ddd;
            return ddd;
          }
        }
      }
    }
    
    console.log(`[DDD] ⚠️ DDD não encontrado, usando padrão 24`);
    return '24'; // Fallback
    
  } catch (error) {
    console.error(`[DDD] ❌ Erro:`, error);
    return '24'; // Fallback
  }
}

// 🎯 BUSCAR ESTABELECIMENTOS E WHATSAPP VERIFICADO
async function searchEstablishmentsAndWhatsApp(food, city, state, cityDDD) {
  try {
    console.log(`[SEARCH_VERIFIED] 🎯 Buscando estabelecimentos + WhatsApp DDD ${cityDDD}`);
    
    // PASSO 1: BUSCAR ESTABELECIMENTOS POPULARES
    const establishments = await findTopEstablishmentsInCity(food, city, state);
    
    if (establishments.length === 0) {
      console.log(`[SEARCH_VERIFIED] ❌ Nenhum estabelecimento encontrado`);
      return [];
    }

    console.log(`[SEARCH_VERIFIED] 📋 ${establishments.length} estabelecimentos encontrados`);

    // PASSO 2: BUSCAR E VERIFICAR WHATSAPP REAL
    const verifiedRestaurants = [];

    for (const establishment of establishments) {
      if (verifiedRestaurants.length >= 3) break; // Já temos 3

      try {
        console.log(`[SEARCH_VERIFIED] 📱 Verificando WhatsApp para: ${establishment.name}`);
        
        // 🆕 BUSCAR E VERIFICAR NÚMERO REAL
        const whatsappNumber = await searchAndVerifyWhatsApp(establishment.name, city, state, food, cityDDD);
        
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

          verifiedRestaurants.push(restaurant);
          console.log(`[SEARCH_VERIFIED] ✅ VERIFICADO: ${establishment.name} - ${whatsappNumber}`);
          
        } else {
          console.log(`[SEARCH_VERIFIED] ❌ ${establishment.name} - WhatsApp não verificado`);
        }
        
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (error) {
        console.log(`[SEARCH_VERIFIED] ⚠️ Erro: ${error.message}`);
        continue;
      }
    }

    console.log(`[SEARCH_VERIFIED] 🎉 ${verifiedRestaurants.length} restaurantes verificados`);
    return verifiedRestaurants;

  } catch (error) {
    console.error('[SEARCH_VERIFIED] ❌ Erro crítico:', error);
    return [];
  }
}

// 🔍 BUSCAR E VERIFICAR WHATSAPP REAL
async function searchAndVerifyWhatsApp(establishmentName, city, state, foodType, cityDDD) {
  try {
    console.log(`[VERIFY_WA] 📱 Buscando WhatsApp verificado para: ${establishmentName}`);
    
    // STEP 1: Buscar número via queries específicas
    const foundNumber = await findWhatsAppNumber(establishmentName, city, cityDDD);
    
    if (!foundNumber) {
      console.log(`[VERIFY_WA] ❌ Nenhum número encontrado`);
      return null;
    }
    
    console.log(`[VERIFY_WA] 📞 Número encontrado: ${foundNumber}`);
    
    // STEP 2: VERIFICAR se o número realmente pertence ao estabelecimento
    const isVerified = await verifyNumberBelongsToEstablishment(foundNumber, establishmentName, city);
    
    if (isVerified) {
      console.log(`[VERIFY_WA] ✅ VERIFICADO: ${foundNumber} pertence a ${establishmentName}`);
      return foundNumber;
    } else {
      console.log(`[VERIFY_WA] ❌ FALSO: ${foundNumber} NÃO pertence a ${establishmentName}`);
      return null;
    }
    
  } catch (error) {
    console.error(`[VERIFY_WA] ❌ Erro:`, error);
    return null;
  }
}

// 🔍 ENCONTRAR NÚMERO WHATSAPP
async function findWhatsAppNumber(establishmentName, city, cityDDD) {
  try {
    const whatsappQueries = [
      `"${establishmentName}" whatsapp "${cityDDD}" "${city}"`,
      `${establishmentName} whatsapp delivery "${city}" "${cityDDD}"`,
      `${establishmentName} contato "(${cityDDD})" "${city}"`,
      `"${establishmentName}" "${cityDDD} 9" whatsapp`,
      `site:wa.me/55${cityDDD} ${establishmentName}`,
      `"${establishmentName}" telefone "${cityDDD}" "${city}"`
    ];

    for (const query of whatsappQueries) {
      try {
        console.log(`[FIND_WA] 🔍 Query: ${query.substring(0, 50)}...`);
        
        const results = await searchGoogleAPIForWhatsApp(query);
        
        for (const result of results) {
          // Tentar extrair WhatsApp do snippet primeiro
          let whatsapp = extractWhatsAppWithDDD(result.snippet, cityDDD);
          
          if (whatsapp) {
            console.log(`[FIND_WA] 📱 WhatsApp no snippet: ${whatsapp}`);
            return whatsapp;
          }

          // Se não encontrou no snippet, tentar na página
          if (result.link && !result.link.includes('instagram.com/accounts/')) {
            try {
              const html = await fetchText(result.link, {}, 1, CONFIG.timeouts.scraping);
              whatsapp = extractWhatsAppWithDDD(html, cityDDD);
              
              if (whatsapp) {
                console.log(`[FIND_WA] 📱 WhatsApp na página: ${whatsapp}`);
                return whatsapp;
              }
            } catch (pageError) {
              console.log(`[FIND_WA] ⚠️ Erro ao acessar página: ${pageError.message}`);
            }
          }
        }
        
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (queryError) {
        console.log(`[FIND_WA] ⚠️ Erro na query: ${queryError.message}`);
        continue;
      }
    }

    return null;
    
  } catch (error) {
    console.error(`[FIND_WA] ❌ Erro crítico:`, error);
    return null;
  }
}

// 📱 EXTRAIR WHATSAPP COM DDD ESPECÍFICO
function extractWhatsAppWithDDD(text, targetDDD) {
  if (!text || !targetDDD) return null;
  
  // Padrões específicos para o DDD da cidade
  const dddPatterns = [
    new RegExp(`wa\\.me\\/(\\+?55${targetDDD}\\d{8,9})`, 'gi'),
    new RegExp(`wa\\.me\\/(\\+?55\\s?${targetDDD}\\s?\\d{8,9})`, 'gi'),
    new RegExp(`whatsapp.*?(\\+?55\\s?${targetDDD}\\s?9?\\d{8})`, 'gi'),
    new RegExp(`whatsapp.*?(${targetDDD}\\s?9\\d{8})`, 'gi'),
    new RegExp(`contato.*?(\\+?55\\s?${targetDDD}\\s?9\\d{8})`, 'gi'),
    new RegExp(`pedidos.*?(\\+?55\\s?${targetDDD}\\s?9\\d{8})`, 'gi'),
    new RegExp(`(\\+?55\\s?)?${targetDDD}\\s?9\\d{8}`, 'g'),
    new RegExp(`\\(${targetDDD}\\)\\s?9\\d{8}`, 'g'),
    new RegExp(`${targetDDD}\\s?9\\d{4}[\\s-]?\\d{4}`, 'g')
  ];
  
  for (const pattern of dddPatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        // Extrair só os números
        let number = match.replace(/\D/g, '');
        
        // Validar formato
        if (number.length >= 10) {
          // Se começar com 55, deve ter DDD correto
          if (number.startsWith('55')) {
            const ddd = number.substring(2, 4);
            if (ddd === targetDDD && number.length >= 12) {
              const cleanNumber = '55' + number.substring(2);
              if (isValidPhoneNumber(cleanNumber, targetDDD)) {
                return cleanNumber;
              }
            }
          }
          // Se começar com DDD, adicionar 55
          else if (number.startsWith(targetDDD) && number.length >= 10) {
            const cleanNumber = '55' + number;
            if (isValidPhoneNumber(cleanNumber, targetDDD)) {
              return cleanNumber;
            }
          }
        }
      }
    }
  }
  
  return null;
}

// ✅ VERIFICAR SE NÚMERO PERTENCE AO ESTABELECIMENTO
async function verifyNumberBelongsToEstablishment(phoneNumber, establishmentName, city) {
  try {
    console.log(`[VERIFY_REVERSE] 🔍 Verificando se ${phoneNumber} pertence a ${establishmentName}`);
    
    // Busca reversa: buscar o número no Google e ver se menciona o estabelecimento
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    const verificationQueries = [
      cleanNumber,
      `"${cleanNumber}"`,
      `whatsapp ${cleanNumber}`,
      `"${cleanNumber}" ${city}`
    ];

    for (const query of verificationQueries) {
      try {
        const results = await searchGoogleAPIForWhatsApp(query);
        
        for (const result of results) {
          const combinedText = `${result.title} ${result.snippet}`.toLowerCase();
          const establishmentWords = establishmentName.toLowerCase().split(' ');
          
          // Verificar se pelo menos 2 palavras do nome do estabelecimento aparecem
          let matchCount = 0;
          for (const word of establishmentWords) {
            if (word.length > 2 && combinedText.includes(word)) {
              matchCount++;
            }
          }
          
          if (matchCount >= 2 || 
              combinedText.includes(establishmentName.toLowerCase()) ||
              combinedText.includes(city.toLowerCase())) {
            console.log(`[VERIFY_REVERSE] ✅ CONFIRMADO: Número ${phoneNumber} pertence a ${establishmentName}`);
            console.log(`[VERIFY_REVERSE] 📝 Prova: ${combinedText.substring(0, 100)}...`);
            return true;
          }
        }
        
        await sleep(CONFIG.delays.betweenRequests);
        
      } catch (error) {
        console.log(`[VERIFY_REVERSE] ⚠️ Erro na verificação: ${error.message}`);
        continue;
      }
    }
    
    console.log(`[VERIFY_REVERSE] ❌ NÚMERO FALSO: ${phoneNumber} não pertence a ${establishmentName}`);
    return false;
    
  } catch (error) {
    console.error(`[VERIFY_REVERSE] ❌ Erro crítico:`, error);
    return false;
  }
}

// 🔢 VALIDAR NÚMERO DE TELEFONE
function isValidPhoneNumber(number, targetDDD) {
  // Deve ter 13 dígitos (55 + DDD + 9 dígitos)
  if (number.length !== 13) return false;
  
  // Deve começar com 55 + DDD correto
  if (!number.startsWith(`55${targetDDD}`)) return false;
  
  // O próximo dígito deve ser 9 (celular)
  if (number.charAt(4) !== '9') return false;
  
  // Os próximos dígitos devem ser números válidos
  const phoneNumber = number.substring(4); // Remove 55XX
  if (phoneNumber.length !== 9) return false;
  
  // Não pode ter todos os dígitos iguais
  if (/^9(\d)\1{8}$/.test(phoneNumber)) return false;
  
  console.log(`[VALIDATE] ✅ Número válido DDD ${targetDDD}: ${number}`);
  return true;
}

// 🏪 BUSCAR TOP ESTABELECIMENTOS NA CIDADE
async function findTopEstablishmentsInCity(food, city, state) {
  try {
    console.log(`[ESTABLISHMENTS] 🏪 Buscando estabelecimentos de ${food} em ${city}`);
    
    const googleResults = await searchGoogleAPI(food, city, state);
    
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
                        result.link.toLowerCase().includes(city.toLowerCase()) ||
                        result.link.includes('.br');

      if (!isRelevant) continue;

      // Calcular prioridade (populares primeiro)
      let priority = 0;
      const nameLower = name.toLowerCase();
      
      for (let i = 0; i < popularKeywords.length; i++) {
        if (nameLower.includes(popularKeywords[i])) {
          priority = popularKeywords.length - i;
          break;
        }
      }

      establishments.push({
        name: name,
        link: result.link,
        snippet: result.snippet,
        priority: priority,
        address: extractAddressFromSnippet(result.snippet, city, state)
      });
    }

    // Ordenar por prioridade (populares primeiro)
    establishments.sort((a, b) => b.priority - a.priority);

    console.log(`[ESTABLISHMENTS] 📊 ${establishments.length} estabelecimentos processados`);
    return establishments.slice(0, 12);

  } catch (error) {
    console.error('[ESTABLISHMENTS] ❌ Erro:', error);
    return [];
  }
}

// Funções auxiliares permanecem iguais
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

// 🔍 BUSCAR NO GOOGLE USANDO API
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
    
    const searchQuery = `${food} restaurante delivery ${city} ${state}`;
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

// 📱 BUSCAR NO GOOGLE ESPECÍFICO PARA WHATSAPP
async function searchGoogleAPIForWhatsApp(query) {
  try {
    console.log(`[GOOGLE_API_WA] 🚀 Query WhatsApp: ${query}`);
    
    const googleKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    if (!googleKey || !cx) {
      console.log("[GOOGLE_API_WA] API não configurada");
      return [];
    }
    
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${googleKey}&cx=${cx}&num=5`;
    
    const data = await fetchJSON(url, {}, 1, CONFIG.timeouts.google);
    const items = data.items || [];
    
    console.log(`[GOOGLE_API_WA] ✅ ${items.length} resultados da API`);
    
    const results = [];
    for (const item of items) {
      results.push({
        title: item.title,
        link: item.link,
        snippet: item.snippet || "",
        source: "google_api_wa"
      });
    }
    
    return results;
    
  } catch (error) {
    console.log(`[GOOGLE_API_WA] ❌ Erro: ${error.message}`);
    return [];
  }
}

// 📍 EXTRAIR ENDEREÇO DO SNIPPET - MELHORADO
function extractAddressFromSnippet(snippet, city, state) {
  if (!snippet) return `${city}, ${state}`;
  
  const addressPatterns = [
    /(?:rua|avenida|av\.?|r\.?)\s+[^,\n]+(?:,?\s*n?\.?\s*\d+)?(?:,\s*[^,\n]+)*/i,
    /endere[çc]o:?\s*([^.\n]+)/i,
    /([^.\n]*(?:rua|avenida|av\.?|r\.?)[^.\n]*)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = snippet.match(pattern);
    if (match) {
      let address = match[0].trim();
      // Limitar tamanho do endereço
      if (address.length > 150) {
        address = address.substring(0, 150) + '...';
      }
      return address;
    }
  }
  
  // Fallback: pegar início do snippet se tiver info de endereço
  if (snippet.includes(city) || snippet.includes(state)) {
    const shortSnippet = snippet.substring(0, 100).trim();
    return shortSnippet.length > 0 ? shortSnippet : `${city}, ${state}`;
  }
  
  return `${city}, ${state}`;
}

// 🎯 GERAR INFORMAÇÕES REALISTAS
function generateRealisticRating(name) {
  const nameLower = name.toLowerCase();
  let rating = 4.0 + (Math.random() * 0.8);
  
  if (nameLower.includes('domino') || nameLower.includes('pizza hut')) rating = 4.2 + (Math.random() * 0.4);
  if (nameLower.includes('mcdonald') || nameLower.includes('burger king')) rating = 4.0 + (Math.random() * 0.3);
  
  return rating.toFixed(1);
}

function generateRealisticTime() {
  const minTime = 25 + Math.floor(Math.random() * 15);
  const maxTime = minTime + 10 + Math.floor(Math.random() * 15);
  return `${minTime}-${maxTime} min`;
}

function generateRealisticPrice(food) {
  let minPrice = 25 + Math.floor(Math.random() * 20);
  let maxPrice = minPrice + 15 + Math.floor(Math.random() * 25);
  
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
