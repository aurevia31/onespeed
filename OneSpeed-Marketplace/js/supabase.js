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
    async signUp({ email, password, name, phone, emailRedirectTo }) {
      if (!client) throw new Error('Supabase is not configured. Add the project URL and anon key in js/supabase-config.js.');
      const { data, error } = await client.auth.signUp({
        email, password,
        options: {
          data: { full_name: name, phone: phone || '' },
          ...(emailRedirectTo ? { emailRedirectTo } : {})
        }
      });
      if (error) throw error;
      return data;
    },
    async applySellerApplication(application) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('apply_seller_application', {
        p_store_name: application.storeName,
        p_store_slug: application.storeName,
        p_description: application.description,
        p_support_email: application.email || null,
        p_contact_phone: application.phone || null,
        p_address: application.address || {},
        p_application_note: application.verificationNote || null
      });
      if (error) throw error;
      return data;
    },
    async adminReviewSellerApplication(userId, approved, note = '') {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_review_seller_application', {
        p_user_id: userId,
        p_approve: approved,
        p_note: note || null
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
    async requestPasswordReset(email, redirectTo) {
      if (!client) throw new Error('Supabase is not configured.');
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo || `${window.location.origin}/reset-password.html`
      });
      if (error) throw error;
    },
    async updatePassword(password) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.auth.updateUser({ password });
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
    async listProducts({
      category,
      query,
      currency,
      minPrice,
      maxPrice,
      inStockOnly = false,
      sort = 'recent',
      limit = 60,
      offset = 0
    } = {}) {
      if (!client) return null;
      let request = client.from('products')
        .select('id,title,description,price,currency,category,stock,image_url,images,seller_id,created_at', { count: 'exact' })
        .eq('status', 'active');
      if (category) request = request.eq('category', category);
      if (query) request = request.textSearch('search_document', query, { type: 'websearch', config: 'english' });
      if (currency) request = request.eq('currency', currency);
      if (minPrice !== undefined && minPrice !== null && minPrice !== '') request = request.gte('price', minPrice);
      if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') request = request.lte('price', maxPrice);
      if (inStockOnly) request = request.gt('stock', 0);
      const ordering = {
        recent: ['created_at', false],
        'price-asc': ['price', true],
        'price-desc': ['price', false],
        name: ['title', true]
      }[sort] || ['created_at', false];
      request = request.order(ordering[0], { ascending: ordering[1] }).order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      const { data, error, count } = await request;
      if (error) throw error;
      return { data, count: count || 0 };
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
        .select('id,order_number,status,currency,subtotal,shipping_amount,total,shipping_address,tracking_number,created_at,order_items(product_title,product_image_url,quantity,unit_price),order_status_history(status,note,created_at)')
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
    async listOrderHistory(orderId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('order_status_history')
        .select('status,note,created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    async listCustomerAddresses() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('customer_addresses')
        .select('id,label,full_name,phone,address,city,state,postal_code,country,latitude,longitude,is_default,created_at,updated_at')
        .order('is_default', { ascending: false }).order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async saveCustomerAddress(address) {
      if (!client) throw new Error('Supabase is not configured.');
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in first.');
      const values = {
        customer_id: user.id,
        label: address.label.trim(),
        full_name: address.fullName.trim(),
        phone: address.phone.trim(),
        address: address.address.trim(),
        city: address.city.trim(),
        state: address.state.trim() || null,
        postal_code: address.postalCode.trim() || null,
        country: address.country.trim(),
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
        is_default: Boolean(address.isDefault)
      };
      const request = address.id
        ? client.from('customer_addresses').update(values).eq('id', address.id).eq('customer_id', user.id)
        : client.from('customer_addresses').insert(values);
      const { data, error } = await request.select().single();
      if (error) throw error;
      return data;
    },
    async deleteCustomerAddress(addressId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { error } = await client.from('customer_addresses').delete().eq('id', addressId);
      if (error) throw error;
    },
    async listWishlist() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('wishlist_items')
        .select('product_id,created_at,products(id,title,description,price,currency,category,stock,image_url,images,status)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async setWishlisted(productId, shouldSave) {
      if (!client) throw new Error('Supabase is not configured.');
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in first.');
      const request = shouldSave
        ? client.from('wishlist_items').upsert({ customer_id: user.id, product_id: productId }, { onConflict: 'customer_id,product_id' })
        : client.from('wishlist_items').delete().eq('customer_id', user.id).eq('product_id', productId);
      const { error } = await request;
      if (error) throw error;
    },
    async listNotifications() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('notifications')
        .select('id,title,message,href,read_at,created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    async markNotificationRead(notificationId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { error } = await client.rpc('mark_notification_read', { p_notification_id: notificationId });
      if (error) throw error;
    },
    async openSupportTicket({ subject, message, orderId }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('open_support_ticket', {
        p_subject: subject, p_message: message, p_order_id: orderId || null
      });
      if (error) throw error;
      return data;
    },
    async listSupportTickets() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('support_tickets')
        .select('id,order_id,subject,message,status,admin_reply,created_at,updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async listCustomerTransferSubmissions() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('bank_transfer_submissions')
        .select('id,order_id,amount,currency,bank_reference,sender_name,status,admin_note,created_at,reviewed_at,orders(order_number)')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    async createProductReview({ productId, orderId, rating, body }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('create_product_review', {
        p_product_id: productId, p_order_id: orderId, p_rating: rating, p_body: body
      });
      if (error) throw error;
      return data;
    },
    async listProductReviews(productId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('reviews')
        .select('id,rating,body,created_at')
        .eq('product_id', productId).eq('is_published', true)
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
    async listReviewableOrders(productId) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('order_items')
        .select('product_id,order_id,orders!inner(id,order_number,status,created_at)')
        .eq('product_id', productId)
        .in('orders.status', ['paid', 'processing', 'shipped', 'delivered'])
        .order('created_at', { referencedTable: 'orders', ascending: false });
      if (error) throw error;
      return data;
    },
    async listAdminUsers(query = '') {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_list_users', { p_query: query.trim(), p_limit: 200 });
      if (error) throw error;
      return data;
    },
    async setAdminUserActive(userId, active, note = '') {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_set_user_active', {
        p_user_id: userId, p_active: active, p_note: note || null
      });
      if (error) throw error;
      return data;
    },
    async setAdminOrderStatus(orderId, status, trackingNumber = '', carrier = '') {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_set_order_status', {
        p_order_id: orderId, p_status: status, p_tracking_number: trackingNumber || null, p_carrier: carrier || null
      });
      if (error) throw error;
      return data;
    },
    async listSellerPayouts() {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.from('seller_payouts')
        .select('id,seller_id,order_item_id,gross_amount,commission_amount,net_amount,status,payout_reference,paid_at,created_at,admin_note')
        .order('created_at', { ascending: false }).limit(250);
      if (error) throw error;
      return data;
    },
    async adminReviewSellerPayout(payoutId, action, reference = '', note = '') {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_review_seller_payout', {
        p_payout_id: payoutId, p_action: action, p_reference: reference || null, p_note: note || null
      });
      if (error) throw error;
      return data;
    },
    async adminReplySupportTicket(ticketId, status, reply) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('admin_reply_support_ticket', {
        p_ticket_id: ticketId, p_status: status, p_reply: reply
      });
      if (error) throw error;
      return data;
    },
    async updateSellerStoreProfile({ storeName, description, email, phone, address }) {
      if (!client) throw new Error('Supabase is not configured.');
      const { data, error } = await client.rpc('update_seller_store_profile', {
        p_store_name: storeName,
        p_description: description,
        p_support_email: email || null,
        p_contact_phone: phone,
        p_address: address || {}
      });
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
