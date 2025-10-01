const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Config do seu webhook de compra (destino)
const WEBHOOKS = {
  main:   'https://webhook.dev.mentoriadeceroalmillonia.com/webhook/fbb146f3-8ea7-4d6b-9661-8e8c83a1af0a',
  upsell: 'https://webhook.dev.mentoriadeceroalmillonia.com/webhook/1d0b188a-6c32-4254-914b-e8d9617e513b'
};

// (opcional) segredo compartilhado para assinatura HMAC do body
const PURCHASE_WEBHOOK_SECRET = process.env.PURCHASE_WEBHOOK_SECRET || null;

// Configuração da API BNB (PRODUÇÃO)
const BNB_CONFIG = {
  authURL: 'https://marketapi.bnb.com.bo/ClientAuthentication.API/api/v1',
  qrURL: 'https://marketapi.bnb.com.bo/QRSimple.API/api/v1',
  accountId: 'WYmfqmcVookiem1K4FBNjg==',
  authorizationId: '65VGbCb1rlp2l9YHjEXKvQ=='
};

// Token de autenticação global
let accessToken = null;
let tokenExpiry = null;

// Cliente Axios para autenticação
const authClient = axios.create({
  baseURL: BNB_CONFIG.authURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Cliente Axios para API principal
const apiClient = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Interceptor para adicionar token automaticamente
apiClient.interceptors.request.use(
  async (config) => {
    await ensureValidToken();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    console.error('Erro no interceptor de request:', error);
    return Promise.reject(error);
  }
);

// Interceptor para tratar respostas e renovar token se necessário
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    console.error('Erro na resposta da API:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      accessToken = null;
      tokenExpiry = null;

      const originalRequest = error.config;
      if (!originalRequest._retry) {
        originalRequest._retry = true;
        await ensureValidToken();
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Garantir token válido
 */
async function ensureValidToken() {
  const now = new Date();

  if (accessToken && tokenExpiry && now < tokenExpiry) {
    return;
  }

  try {
    await authenticateWithBNB();
  } catch (error) {
    console.error('Erro ao autenticar com BNB:', error);
    throw new Error('Falha na autenticação com o banco');
  }
}

/**
 * Autenticar com BNB
 */
async function authenticateWithBNB() {
  try {
    console.log('Autenticando com BNB (Produção)...');

    const authData = {
      accountId: BNB_CONFIG.accountId,
      authorizationId: BNB_CONFIG.authorizationId
    };

    const response = await authClient.post('/auth/token', authData);

    if (response.data.success) {
      accessToken = response.data.message; // Token vem no campo 'message'
      tokenExpiry = new Date(Date.now() + (3600 - 300) * 1000); // 55 minutos

      console.log('Autenticação realizada com sucesso');
      console.log('Token expira em:', tokenExpiry.toISOString());

      return { success: true, token: accessToken };
    } else {
      throw new Error(response.data.message || 'Falha na autenticação');
    }

  } catch (error) {
    console.error('Erro na autenticação BNB:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });

    accessToken = null;
    tokenExpiry = null;

    throw new Error(`Falha na autenticação: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Gerar ID único para transação
 */
function generateTransactionId() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 15);
  return `MENT_${timestamp}_${random}`;
}

/**
 * Converter BRL para BOB
 */
function convertBRLToBOB(amountBRL) {
  const exchangeRate = 1.5; // 1 BRL ≈ 1.5 BOB
  return Math.round(amountBRL * exchangeRate * 100) / 100;
}

/**
 * Obter data de expiração (24 horas)
 */
function getExpirationDate() {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 1); // +1 dia
  return expirationDate.toISOString().split('T')[0];
}

/**
 * Criar QR Code Simple
 */
async function createQRSimplePayment(paymentData) {
  try {
    const transactionId = generateTransactionId();
    const amountBOB = Number(paymentData.amount); // já em BOB

    const qrPayload = {
      currency: "BOB",
      gloss: `Mentoría - ${paymentData.customer.name}`,
      amount: amountBOB.toFixed(2),
      singleUse: true,
      expirationDate: getExpirationDate()
    };

    console.log('Criando QR Simple:', {
      transactionId,
      amountBOB,
      customer: paymentData.customer.name,
      expirationDate: qrPayload.expirationDate
    });

    const response = await apiClient.post(
      `${BNB_CONFIG.qrURL}/main/getQRWithImageAsync`,
      qrPayload
    );

    console.log('Resposta do BNB:', response.data);

    if (response.data.success) {
      const qrId  = response.data.qrId || response.data.id;
      const qrPng = response.data.qr || response.data.qrImage || response.data.qrContent;

      const paymentResult = {
        success: true,
        transaction_id: transactionId,
        payment_id: qrId,
        qr_id: qrId,
        qr_code_image: qrPng?.startsWith('data:image') ? qrPng : `data:image/png;base64,${qrPng || ''}`,
        qr_code_text: null,
        amount_bob: amountBOB,
        currency: 'BOB',
        expires_at: qrPayload.expirationDate,
        status: 'pending',
        customer: paymentData.customer,
        extras: paymentData.extras || [],
        product: paymentData.product || 'Mentoría de Cero al Millón',
        product_type: paymentData.product_type || 'main', // <<< importante
        created_at: new Date().toISOString(),
        gloss: qrPayload.gloss
      };

      storePaymentData(paymentResult);
      return paymentResult;
    }
    throw new Error(response.data.message || 'Erro ao criar QR code');
  } catch (error) {
    console.error('Erro ao criar QR Simple:', error.response?.data || error.message);
    return {
      success: false,
      error: 'Erro ao criar QR code de pagamento',
      details: error.response?.data?.message || error.message,
      code: error.response?.status || 500
    };
  }
}

/**
 * Decide o webhook de destino (main x upsell)
 */
function resolvePurchaseWebhook(payment) {
  const type = (payment.product_type || '').toLowerCase();
  if (type === 'upsell') return WEBHOOKS.upsell;
  if (type === 'main')   return WEBHOOKS.main;

  // fallback com heurística no nome do produto
  const p = String(payment.product || '').toLowerCase();
  if (p.includes('upsell')) return WEBHOOKS.upsell;

  return WEBHOOKS.main;
}

/**
 * Monta o payload padronizado do evento
 */
function buildPurchasePayload(paymentObj) {
  return {
    event: 'purchase.completed',
    version: '1.0',
    provider: 'BNB-QR-Simple',
    payment_id: paymentObj.payment_id || paymentObj.qr_id || null,
    status: 'paid',
    currency: paymentObj.currency || 'BOB',
    amount_bob: Number(paymentObj.amount_bob || paymentObj.amount || 0),
    paid_at: paymentObj.payment_date || new Date().toISOString(),
    product: paymentObj.product || 'Mentoría de Cero al Millón',
    product_type: paymentObj.product_type || 'main',
    customer: {
      name:  paymentObj.customer?.name  || null,
      email: paymentObj.customer?.email || null,
      phone: paymentObj.customer?.phone || null,
    },
    extras: paymentObj.extras || [],
    meta: {
      transaction_id: paymentObj.transaction_id || null,
      gloss: paymentObj.gloss || null,
      provider_status_code: paymentObj.provider_status_code || null,
      provider_qr_id: paymentObj.provider_qr_id || null,
      voucher_id: paymentObj.voucher_id || null,
      created_at: paymentObj.created_at || null,
      updated_at: new Date().toISOString()
    }
  };
}

function signBodyHmacSha256(secret, bodyString) {
  return crypto.createHmac('sha256', secret).update(bodyString, 'utf8').digest('hex');
}

async function postWithRetry(url, data, headers = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.post(url, data, { timeout: 15000, headers });
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Notifica o webhook apenas uma vez, quando o pagamento estiver "paid"
 */
async function notifyPurchaseWebhookOnce(paymentId) {
  try {
    const paymentsFile = path.join(__dirname, 'payments.json');
    if (!fs.existsSync(paymentsFile)) return { skipped: true, reason: 'storage_missing' };

    const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
    const payment  = payments[paymentId];
    if (!payment) return { skipped: true, reason: 'payment_not_found' };

    if (payment.webhook_notified) return { skipped: true, reason: 'already_notified' };
    if (!(payment.status === 'paid' || payment.is_paid)) return { skipped: true, reason: 'not_paid' };

    const DEST_URL = resolvePurchaseWebhook(payment);
    if (!DEST_URL) return { skipped: true, reason: 'no_destination' };

    const payload = buildPurchasePayload(payment);
    const body    = JSON.stringify(payload);

    const headers = { 'Content-Type': 'application/json', 'X-Event': payload.event };
    if (PURCHASE_WEBHOOK_SECRET) {
      headers['X-Signature'] = signBodyHmacSha256(PURCHASE_WEBHOOK_SECRET, body);
    }

    await postWithRetry(DEST_URL, payload, headers, 3);

    payment.webhook_notified = true;
    payment.webhook_notified_at = new Date().toISOString();
    payments[paymentId] = payment;
    fs.writeFileSync(paymentsFile, JSON.stringify(payments, null, 2));

    console.log('[WEBHOOK] Notificado com sucesso:', paymentId, '->', DEST_URL);
    return { ok: true };
  } catch (err) {
    console.error('[WEBHOOK] Falha ao notificar:', paymentId, err.response?.status, err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Verificar status do QR (BNB: POST /main/getQRStatusAsync)
 */
async function checkQRSimpleStatus(qrId) {
  try {
    const r = await apiClient.post(
      `${BNB_CONFIG.qrURL}/main/getQRStatusAsync`,
      { qrId: String(qrId) }
    );

    const data = r?.data || {};
    console.log('[BNB][getQRStatusAsync] raw:', JSON.stringify(data));

    if (data.success === false) {
      throw new Error(data?.message || 'Falha ao consultar status do QR');
    }

    const statusCodeRaw =
      data?.statusId ??           // principal no seu ambiente
      data?.qrId ??               // outros ambientes
      data?.qrStatus ??           // outros ambientes
      data?.status ?? null;       // string em alguns lugares

    const statusNum = Number(statusCodeRaw);
    let status = 'pending';
    let isPaid = false;

    if (!Number.isNaN(statusNum)) {
      if (statusNum === 2) { status = 'paid'; isPaid = true; }
      else if (statusNum === 3) { status = 'expired'; }
      else if (statusNum === 4) { status = 'error'; }
      else { status = 'pending'; }
    } else {
      const sc = String(statusCodeRaw || '').toUpperCase();
      if (sc === 'USED' || sc === 'PAID') { status = 'paid'; isPaid = true; }
      else if (sc === 'EXPIRED') { status = 'expired'; }
      else if (sc === 'ERROR') { status = 'error'; }
      else { status = 'pending'; }
    }

    return {
      success: true,
      qr_id: String(qrId),
      status,
      is_paid: isPaid,
      expirationDate: data.expirationDate ?? null,
      provider_status_code: statusCodeRaw,
      provider_qr_id: data?.id ?? null,
      voucher_id: data?.voucherId ?? null
    };
  } catch (err) {
    console.error('Erro em getQRStatusAsync:', err.response?.data || err.message);
    return { success: true, qr_id: String(qrId), status: 'pending', is_paid: false };
  }
}

/**
 * Armazenar dados do pagamento
 */
function storePaymentData(paymentData) {
  try {
    const paymentsFile = path.join(__dirname, 'payments.json');
    let payments = {};

    if (fs.existsSync(paymentsFile)) {
      payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
    }

    payments[paymentData.payment_id] = paymentData;

    fs.writeFileSync(paymentsFile, JSON.stringify(payments, null, 2));
    console.log('Dados do pagamento salvos:', paymentData.payment_id);
  } catch (error) {
    console.error('Erro ao salvar dados do pagamento:', error);
  }
}

/**
 * Recuperar dados do pagamento
 */
function getStoredPaymentData(paymentId) {
  try {
    const paymentsFile = path.join(__dirname, 'payments.json');

    if (fs.existsSync(paymentsFile)) {
      const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
      return payments[paymentId] || null;
    }

    return null;
  } catch (error) {
    console.error('Erro ao recuperar dados do pagamento:', error);
    return null;
  }
}

/**
 * Atualizar status salvo quando o pagamento virar "paid"
 */
function updateStoredPaymentStatus(paymentId, statusObj) {
  try {
    const paymentsFile = path.join(__dirname, 'payments.json');
    if (!fs.existsSync(paymentsFile)) return;

    const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
    const current = payments[paymentId];
    if (!current) return;

    payments[paymentId] = {
      ...current,
      status: statusObj.status || current.status,
      is_paid: !!statusObj.is_paid,
      payment_date: statusObj.payment_date || current.payment_date || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    fs.writeFileSync(paymentsFile, JSON.stringify(payments, null, 2));
    console.log('Status atualizado em payments.json:', paymentId, '->', payments[paymentId].status);
  } catch (err) {
    console.error('Erro ao atualizar status no storage:', err);
  }
}

// ROTAS DA API

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Criar pagamento
app.post('/api/create-payment', async (req, res) => {
  try {
    const { customer, amount, extras, product, product_type } = req.body; // <<< inclui product_type

    // Validações
    if (!customer || !customer.name || !customer.email || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios: customer (name, email), amount'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'O valor deve ser maior que zero'
      });
    }

    console.log('Nova solicitação de pagamento:', {
      customer: customer.name,
      amount,
      extras: extras?.length || 0,
      product_type: product_type || 'main'
    });

    // Processar pagamento usando QR Simple
    const paymentResult = await createQRSimplePayment({
      customer,
      amount,
      extras,
      product,
      product_type // <<< repassa para ser salvo
    });

    if (paymentResult.success) {
      res.json({
        success: true,
        payment_id: paymentResult.payment_id,
        qr_id: paymentResult.qr_id,
        qr_code_image: paymentResult.qr_code_image,
        qr_code_text: paymentResult.qr_code_text, // continuará null
        amount_bob: paymentResult.amount_bob,
        expires_at: paymentResult.expires_at,
        status: paymentResult.status,
        gloss: paymentResult.gloss
      });

    } else {
      res.status(500).json({
        success: false,
        error: paymentResult.error,
        details: paymentResult.details
      });
    }

  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

// Verificar status do pagamento
app.get('/api/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log('Verificando status do pagamento (qrId):', paymentId);

    const statusResult = await checkQRSimpleStatus(paymentId);
    console.log('[API] status normalizado =>', statusResult);

    if (statusResult.success && (statusResult.is_paid || statusResult.status === 'paid')) {
      updateStoredPaymentStatus(paymentId, statusResult);
      await notifyPurchaseWebhookOnce(paymentId); // <<< dispara webhook 1x quando pago
    }

    res.json({
      success: statusResult.success,
      payment_id: String(paymentId),
      status: statusResult.status || 'pending',
      is_paid: !!statusResult.is_paid,
      payment_date: statusResult.payment_date || null,
      amount: statusResult.amount || null,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao verificar status:', error);
    res.status(500).json({ success: false, error: 'Erro ao verificar status do pagamento' });
  }
});

// Obter detalhes do pagamento
app.get('/api/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const paymentData = getStoredPaymentData(paymentId);

    if (paymentData) {
      res.json({
        success: true,
        payment: paymentData
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Pagamento não encontrado'
      });
    }

  } catch (error) {
    console.error('Erro ao obter detalhes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Webhook para notificações do banco (se usar callback do BNB futuramente)
app.post('/webhook/payment', async (req, res) => {
  try {
    const webhookData = req.body;

    console.log('Webhook recebido:', webhookData);
    // Aqui você pode processar a notificação do banco e,
    // se identificar "paid", chamar updateStoredPaymentStatus + notifyPurchaseWebhookOnce

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Página de sucesso
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pagamento Aprovado</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
          .success-card { background: white; border-radius: 20px; padding: 40px; margin-top: 50px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="row justify-content-center">
            <div class="col-md-6">
              <div class="success-card text-center">
                <i class="fas fa-check-circle text-success" style="font-size: 4rem;"></i>
                <h2 class="mt-3 mb-3">¡Pago Aprobado!</h2>
                <p class="lead">Tu compra ha sido procesada exitosamente.</p>
                <p>Recibirás un email con el acceso al curso en breve.</p>
                <hr>
                <p class="text-muted">Gracias por confiar en nosotros</p>
                <a href="/" class="btn btn-primary btn-lg">
                  <i class="fas fa-home"></i> Volver al inicio
                </a>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
  console.log('Configuração BNB QR Simple API:');
  console.log('- Auth URL:', BNB_CONFIG.authURL);
  console.log('- QR URL:', BNB_CONFIG.qrURL);

  // Testar autenticação na inicialização
  authenticateWithBNB()
    .then(() => console.log('Autenticação inicial realizada com sucesso'))
    .catch(error => console.error('Erro na autenticação inicial:', error.message));
});

module.exports = app;
