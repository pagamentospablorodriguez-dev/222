# IA Fome - Revolucionando o Delivery com Inteligência Artificial

## 🚀 Sobre o Projeto

O IA Fome é uma plataforma revolucionária que transforma como as pessoas pedem comida online. Ao invés de navegar por menus complexos, os usuários simplesmente conversam com nossa IA, que cuida de todo o processo de pedido automaticamente.

## ✨ Funcionalidades

- **Chat Inteligente**: Interface conversacional natural com Gemini 1.5 Flash
- **Automação Completa**: IA busca restaurantes, faz pedidos e acompanha entregas
- **WhatsApp Integration**: Comunicação automática com restaurantes via Evolution API
- **Zero Fricção**: Funciona sem cadastro, pagamento na entrega
- **Design Premium**: Interface nível enterprise com dark/light mode

## 🛠️ Tecnologias

- **Frontend**: React + TypeScript + Tailwind CSS + Framer Motion
- **Backend**: Netlify Functions + Node.js
- **IA**: Google Gemini 1.5 Flash
- **WhatsApp**: Evolution API
- **Deploy**: Netlify

## 🚀 Deploy no Netlify

### 1. Configurar Variáveis de Ambiente

No painel do Netlify, adicione as seguintes variáveis:

```
VITE_GOOGLE_AI_API_KEY=
VITE_EVOLUTION_API_URL=
VITE_EVOLUTION_TOKEN=
VITE_EVOLUTION_INSTANCE_ID=
```

### 2. Configurar Webhook no Evolution

No painel do Evolution API, configure o webhook:

- **URL**: `https://iafome.netlify.app/.netlify/functions/webhook`
- **Eventos**: Marque "message.upsert"

### 3. Build e Deploy

```bash
npm install
npm run build
```

O Netlify fará o deploy automaticamente.

## 📱 Como Funciona

1. **Cliente conversa**: Usuário diz o que quer comer
2. **IA processa**: Gemini entende e coleta informações necessárias
3. **Busca restaurante**: Sistema encontra melhores opções na região
4. **Faz pedido**: IA entra em contato com restaurante via WhatsApp
5. **Acompanha**: Cliente recebe atualizações em tempo real

## 🔧 Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Executar em desenvolvimento
npm run dev

# Testar functions localmente
netlify dev
```

## 📞 Configuração Evolution API

### Dados da Instância:
- **Projeto**: IA Fome
- **Instância**:
- **URL**: 
- **ID**: 
- **Token**: 

### Webhook Configuration:
- **URL**: `https://iafome.netlify.app/.netlify/functions/webhook`
- **Events**: message.upsert

## 🎯 Arquitetura do Sistema

```
Cliente (IA Fome) ←→ Gemini 1.5 Flash ←→ Evolution API ←→ Restaurante (WhatsApp)
                                ↓
                        Netlify Functions
                                ↓
                        Gerenciamento de Estado
```

## 🔐 Segurança

- Todas as APIs keys são armazenadas como variáveis de ambiente
- Comunicação HTTPS end-to-end
- Validação de dados em todas as camadas
- Rate limiting implementado

## 📈 Próximos Passos

- [ ] Integração com Google Places API para busca real de restaurantes
- [ ] Sistema de pagamento online
- [ ] Histórico de pedidos
- [ ] Avaliações e reviews
- [ ] Programa de fidelidade

## 🏆 Diferencial Competitivo

O IA Fome é a primeira plataforma de delivery 100% baseada em IA conversacional, oferecendo uma experiência única e patenteável que revoluciona o mercado tradicional de food delivery.

---

**IA Fome: A Intuição te deu o Sabor. (C🔱)**
*Feito com Propósito Divino.*
