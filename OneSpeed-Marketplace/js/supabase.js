/* OneSpeed Supabase bridge. Existing static-demo mode remains available until configured. */
(function () {
  const cfg = window.ONESPEED_SUPABASE_CONFIG || {};
  const configured = Boolean(cfg.url && cfg.anonKey);
  let client = null;
  if (configured && window.supabase?.createClient) {
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  const bridge = {
    configured: () => configured && Boolean(client),
    client: () => client,
    async currentUser() {
      if (!client) return null;
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      return data.user;
    },
    async signUp({ email, password, name, phone, role = 'customer' }) {
      if (!client) throw new Error('Supabase is not configured. Add the project URL and anon key in js/supabase-config.js.');
      if (!['customer', 'seller'].includes(role)) throw new Error('Invalid account role.');
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { full_name: name, phone: phone || '', requested_role: role } }
      });
      if (error) throw error;
      return data;
    },
    async signIn(email, password) {
      if (!client) throw new Error('Supabase is not configured. Add the project URL and anon key in js/supabase-config.js.');
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async profile() {
      const user = await this.currentUser();
      if (!user) return null;
      const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return { ...data, email: user.email };
    },
    async listProducts({ category, query, limit = 60 } = {}) {
      if (!client) return null;
      let request = client.from('products').select('id,title,description,price,currency,category,stock,image_url,images,seller_id,created_at').eq('status', 'active').gt('stock', 0).order('created_at', { ascending: false }).limit(limit);
      if (category) request = request.eq('category', category);
      if (query) request = request.textSearch('search_document', query, { type: 'websearch', config: 'english' });
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },
    async getProduct(productId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('products')
        .select('id,title,description,price,currency,category,stock,image_url,images,seller_id,created_at')
        .eq('id', productId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async getProductsByIds(productIds) {
      if (!client) throw new Error('Supabase is not configured.');
      if (!productIds.length) return [];
      const { data, error } = await client.from('products')
        .select('id,title,description,price,currency,category,stock,image_url,images,seller_id,created_at')
        .in('id', productIds)
        .eq('status', 'active');
      if (error) throw error;
      return data;
    },
    async uploadProductImage(file) {
      if (!client) throw new Error('Supabase is not configured.');
      if (!file || !/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error('Choose a JPG, PNG, WebP or AVIF image.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.');
      const user = await this.currentUser();
      if (!user) throw new Error('Please sign in first.');
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' })[file.type];
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = client.storage.from('product-images').getPublicUrl(path);
      return { path, url: data.publicUrl };
    },
    async createBankTransferSubmission({ orderId, amount, currency, reference, senderName, proofPath }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('submit_bank_transfer', {
        p_order_id: orderId, p_amount: amount, p_currency: currency, p_reference: reference,
        p_sender_name: senderName, p_proof_path: proofPath || null
      });
      if (error) throw error;
      return data;
    },
    async quoteDeliveryFee({ country, state, city, currency }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('quote_delivery_fee', {
        p_country: country, p_state: state || '', p_city: city, p_currency: currency
      });
      if (error) throw error;
      return data;
    },
    async placeOrder({ items, shippingAddress, currency }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('place_order', {
        p_items: items.map(item => ({ product_id: item.productId, quantity: item.quantity })),
        p_shipping_address: shippingAddress,
        p_currency: currency,
        p_shipping_amount: 0
      });
      if (error) throw error;
      return data;
    },
    async getOrder(orderId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('orders')
        .select('id,order_number,status,currency,subtotal,shipping_amount,total,shipping_address,tracking_number,created_at,order_items(product_title,product_image_url,quantity,unit_price)')
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
    async listOrders() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('orders')
        .select('id,order_number,status,currency,total,shipping_address,tracking_number,created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    async listCustomerOrders(customerId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('orders')
        .select('id,order_number,status,currency,total,shipping_address,tracking_number,created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    async uploadTransferProof(file) {
      if (!client) throw new Error('Supabase is not configured.');
      if (!file || !/^image\/(jpeg|png|webp|pdf)$/.test(file.type)) throw new Error('Choose a JPG, PNG, WebP or PDF receipt.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Receipt must be 8 MB or smaller.');
      const user = await this.currentUser();
      if (!user) throw new Error('Please sign in first.');
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from('transfer-proofs').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      return path;
    }
  };
  window.OneSpeedBackend = bridge;
  if (configured && !client) console.error('OneSpeed: Supabase config exists, but the Supabase JS library failed to load.');
})();
