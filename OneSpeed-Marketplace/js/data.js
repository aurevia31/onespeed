// OneSpeed Market - Core Data & State Management
const OSM = {
  // Currencies with mock exchange rates relative to USD
  currencies: {
    USD: { symbol: '$', rate: 1, name: 'US Dollar' },
    EUR: { symbol: '€', rate: 0.92, name: 'Euro' },
    GBP: { symbol: '£', rate: 0.79, name: 'British Pound' },
    NGN: { symbol: '₦', rate: 1550, name: 'Nigerian Naira' },
    GHS: { symbol: 'GH₵', rate: 15.5, name: 'Ghanaian Cedi' },
    KES: { symbol: 'KSh', rate: 129, name: 'Kenyan Shilling' },
    ZAR: { symbol: 'R', rate: 18.2, name: 'South African Rand' },
    INR: { symbol: '₹', rate: 83.5, name: 'Indian Rupee' },
    CNY: { symbol: '¥', rate: 7.25, name: 'Chinese Yuan' },
    JPY: { symbol: '¥', rate: 149, name: 'Japanese Yen' },
    CAD: { symbol: 'C$', rate: 1.36, name: 'Canadian Dollar' },
    AUD: { symbol: 'A$', rate: 1.53, name: 'Australian Dollar' },
    BRL: { symbol: 'R$', rate: 5.1, name: 'Brazilian Real' },
    MXN: { symbol: 'MX$', rate: 17.2, name: 'Mexican Peso' },
    AED: { symbol: 'د.إ', rate: 3.67, name: 'UAE Dirham' },
    SAR: { symbol: '﷼', rate: 3.75, name: 'Saudi Riyal' },
    TRY: { symbol: '₺', rate: 32.5, name: 'Turkish Lira' },
    EGP: { symbol: 'E£', rate: 48.5, name: 'Egyptian Pound' },
    PKR: { symbol: '₨', rate: 278, name: 'Pakistani Rupee' },
    BDT: { symbol: '৳', rate: 117, name: 'Bangladeshi Taka' }
  },

  // Seed products (admin can add more)
  seedProducts: [
    { id: 1, title: "Wireless Bluetooth Earbuds Pro", price: 12.99, category: "Electronics", stock: 150, sales: 2340, rating: 4.6, image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&h=400&fit=crop", description: "Premium noise-cancelling wireless earbuds with 40hr battery life. Crystal clear sound and comfortable fit.", images: ["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&h=400&fit=crop"], createdAt: Date.now() - 86400000 * 10 },
    { id: 2, title: "Men's Casual Slim Fit Shirt", price: 18.50, category: "Fashion", stock: 80, sales: 1890, rating: 4.4, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=400&fit=crop", description: "Breathable cotton slim-fit shirt available in multiple colors. Perfect for office or casual wear.", images: [], createdAt: Date.now() - 86400000 * 8 },
    { id: 3, title: "Smart Watch Fitness Tracker", price: 29.99, category: "Electronics", stock: 200, sales: 5120, rating: 4.7, image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop", description: "Track steps, heart rate, sleep. Waterproof, long battery, multiple sports modes.", images: [], createdAt: Date.now() - 86400000 * 15 },
    { id: 4, title: "Portable Mini Blender", price: 15.99, category: "Home", stock: 120, sales: 980, rating: 4.3, image: "https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=400&h=400&fit=crop", description: "USB rechargeable personal blender. Perfect for smoothies on the go.", images: [], createdAt: Date.now() - 86400000 * 5 },
    { id: 5, title: "Women's Crossbody Handbag", price: 22.00, category: "Fashion", stock: 65, sales: 1450, rating: 4.5, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&h=400&fit=crop", description: "Stylish vegan leather crossbody bag with multiple compartments.", images: [], createdAt: Date.now() - 86400000 * 12 },
    { id: 6, title: "LED Desk Lamp with USB", price: 14.50, category: "Home", stock: 90, sales: 760, rating: 4.2, image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400&h=400&fit=crop", description: "Adjustable brightness, eye-care LED, USB charging port.", images: [], createdAt: Date.now() - 86400000 * 7 },
    { id: 7, title: "Running Shoes Lightweight", price: 34.99, category: "Sports", stock: 110, sales: 3200, rating: 4.6, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=400&fit=crop", description: "Breathable mesh upper, cushioned sole for maximum comfort during runs.", images: [], createdAt: Date.now() - 86400000 * 20 },
    { id: 8, title: "Ceramic Coffee Mug Set (4pcs)", price: 19.99, category: "Home", stock: 75, sales: 890, rating: 4.8, image: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400&h=400&fit=crop", description: "Handcrafted ceramic mugs, microwave and dishwasher safe.", images: [], createdAt: Date.now() - 86400000 * 3 },
    { id: 9, title: "Bluetooth Portable Speaker", price: 24.99, category: "Electronics", stock: 140, sales: 4100, rating: 4.5, image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=400&fit=crop", description: "360° sound, 20hr playtime, waterproof IPX7, deep bass.", images: [], createdAt: Date.now() - 86400000 * 9 },
    { id: 10, title: "Yoga Mat Non-Slip Premium", price: 16.99, category: "Sports", stock: 200, sales: 2780, rating: 4.7, image: "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=400&h=400&fit=crop", description: "Extra thick 8mm, eco-friendly TPE material, carrying strap included.", images: [], createdAt: Date.now() - 86400000 * 6 },
    { id: 11, title: "Kids Building Blocks Set 100pcs", price: 11.50, category: "Toys", stock: 180, sales: 1560, rating: 4.4, image: "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=400&fit=crop", description: "Safe ABS plastic, compatible with major brands, storage box included.", images: [], createdAt: Date.now() - 86400000 * 4 },
    { id: 12, title: "Stainless Steel Water Bottle 1L", price: 13.99, category: "Sports", stock: 250, sales: 3890, rating: 4.6, image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=400&fit=crop", description: "Double-wall insulated, keeps cold 24h / hot 12h. Leak-proof.", images: [], createdAt: Date.now() - 86400000 * 11 }
  ],

  // Initialize storage
  init() {
    if (!localStorage.getItem('osm_products')) {
      localStorage.setItem('osm_products', JSON.stringify(this.seedProducts));
    }
    if (!localStorage.getItem('osm_users')) {
      // Default admin
      localStorage.setItem('osm_users', JSON.stringify([
        { id: 1, email: 'admin@onespeed.market', password: 'admin123', name: 'Platform Admin', role: 'admin', verified: true, createdAt: Date.now() },
        { id: 2, email: 'demo@customer.com', password: 'demo123', name: 'Demo Customer', role: 'customer', verified: true, phone: '+2348012345678', createdAt: Date.now() - 86400000 }
      ]));
    }
    if (!localStorage.getItem('osm_orders')) {
      localStorage.setItem('osm_orders', JSON.stringify([]));
    }
    if (!localStorage.getItem('osm_currency')) {
      localStorage.setItem('osm_currency', 'USD');
    }
    if (!localStorage.getItem('osm_cart')) {
      localStorage.setItem('osm_cart', JSON.stringify([]));
    }
  },

  // Products
  getProducts() {
    return JSON.parse(localStorage.getItem('osm_products') || '[]');
  },
  saveProducts(products) {
    localStorage.setItem('osm_products', JSON.stringify(products));
  },
  getProduct(id) {
    return this.getProducts().find(p => String(p.id) === String(id));
  },
  addProduct(product) {
    const products = this.getProducts();
    product.id = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
    product.createdAt = Date.now();
    product.sales = product.sales || 0;
    product.rating = product.rating || 4.5;
    product.images = product.images || [];
    products.push(product);
    this.saveProducts(products);
    return product;
  },
  updateProduct(id, updates) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === Number(id));
    if (idx !== -1) {
      products[idx] = { ...products[idx], ...updates };
      this.saveProducts(products);
      return products[idx];
    }
    return null;
  },
  deleteProduct(id) {
    let products = this.getProducts();
    products = products.filter(p => p.id !== Number(id));
    this.saveProducts(products);
  },

  // Users
  getUsers() {
    return JSON.parse(localStorage.getItem('osm_users') || '[]');
  },
  saveUsers(users) {
    localStorage.setItem('osm_users', JSON.stringify(users));
  },
  getUser(id) {
    return this.getUsers().find(u => u.id === Number(id));
  },
  registerUser(user) {
    const users = this.getUsers();
    if (users.find(u => u.email.toLowerCase() === user.email.toLowerCase())) {
      return { error: 'Email already registered' };
    }
    user.id = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
    user.role = 'customer';
    user.verified = false; // Admin must approve
    user.createdAt = Date.now();
    users.push(user);
    this.saveUsers(users);
    return { success: true, user };
  },
  login(email, password) {
    const user = this.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) return { error: 'Invalid email or password' };
    if (user.role === 'customer' && !user.verified) {
      return { error: 'Account pending admin verification. Please wait for approval.' };
    }
    localStorage.setItem('osm_session', JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role }));
    return { success: true, user };
  },
  logout() {
    localStorage.removeItem('osm_session');
  },
  getSession() {
    return JSON.parse(localStorage.getItem('osm_session') || 'null');
  },
  isLoggedIn() {
    return !!this.getSession();
  },
  isAdmin() {
    const s = this.getSession();
    return s && s.role === 'admin';
  },
  updateUser(id, updates) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === Number(id));
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...updates };
      this.saveUsers(users);
      return users[idx];
    }
    return null;
  },

  // Cart
  getCart() {
    return JSON.parse(localStorage.getItem('osm_cart') || '[]');
  },
  saveCart(cart) {
    localStorage.setItem('osm_cart', JSON.stringify(cart));
  },
  addToCart(productId, qty = 1) {
    const cart = this.getCart();
    const normalizedId = Number.isNaN(Number(productId)) ? String(productId) : Number(productId);
    const existing = cart.find(i => String(i.productId) === String(normalizedId));
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ productId: normalizedId, qty });
    }
    this.saveCart(cart);
    return cart;
  },
  updateCartQty(productId, qty) {
    let cart = this.getCart();
    const normalizedId = Number.isNaN(Number(productId)) ? String(productId) : Number(productId);
    if (qty <= 0) {
      cart = cart.filter(i => String(i.productId) !== String(normalizedId));
    } else {
      const item = cart.find(i => String(i.productId) === String(normalizedId));
      if (item) item.qty = qty;
    }
    this.saveCart(cart);
    return cart;
  },
  clearCart() {
    this.saveCart([]);
  },
  getCartCount() {
    return this.getCart().reduce((sum, i) => sum + i.qty, 0);
  },
  getCartTotal() {
    const cart = this.getCart();
    const products = this.getProducts();
    return cart.reduce((sum, item) => {
      const p = products.find(pr => String(pr.id) === String(item.productId));
      return sum + (p ? p.price * item.qty : 0);
    }, 0);
  },

  // Orders
  getOrders() {
    return JSON.parse(localStorage.getItem('osm_orders') || '[]');
  },
  saveOrders(orders) {
    localStorage.setItem('osm_orders', JSON.stringify(orders));
  },
  createOrder(orderData) {
    const orders = this.getOrders();
    const order = {
      id: orders.length ? Math.max(...orders.map(o => o.id)) + 1 : 1001,
      ...orderData,
      status: 'pending', // pending -> approved -> confirmed -> shipped -> delivered
      trackingCode: null,
      createdAt: Date.now(),
      history: [{ status: 'pending', date: Date.now(), note: 'Order placed' }]
    };
    orders.unshift(order);
    this.saveOrders(orders);
    this.clearCart();
    return order;
  },
  updateOrder(id, updates) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === Number(id));
    if (idx !== -1) {
      const oldStatus = orders[idx].status;
      orders[idx] = { ...orders[idx], ...updates };
      if (updates.status && updates.status !== oldStatus) {
        orders[idx].history = orders[idx].history || [];
        orders[idx].history.push({ status: updates.status, date: Date.now(), note: updates.note || `Status changed to ${updates.status}` });
      }
      if (updates.trackingCode) {
        orders[idx].history.push({ status: 'shipped', date: Date.now(), note: `Tracking code issued: ${updates.trackingCode}` });
      }
      this.saveOrders(orders);
      return orders[idx];
    }
    return null;
  },
  getOrder(id) {
    return this.getOrders().find(o => o.id === Number(id));
  },
  getUserOrders(userId) {
    return this.getOrders().filter(o => o.userId === Number(userId));
  },

  // Currency
  getCurrency() {
    return localStorage.getItem('osm_currency') || 'USD';
  },
  setCurrency(code) {
    localStorage.setItem('osm_currency', code);
  },
  formatPrice(usdAmount) {
    const code = this.getCurrency();
    const cur = this.currencies[code] || this.currencies.USD;
    const converted = usdAmount * cur.rate;
    // Format based on currency
    if (['JPY', 'KRW'].includes(code)) {
      return `${cur.symbol}${Math.round(converted).toLocaleString()}`;
    }
    if (['NGN', 'KES', 'PKR', 'BDT', 'INR'].includes(code)) {
      return `${cur.symbol}${Math.round(converted).toLocaleString()}`;
    }
    return `${cur.symbol}${converted.toFixed(2)}`;
  },

  // Generate tracking code
  generateTrackingCode() {
    const prefix = 'OSM';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = prefix;
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  // Toast notification
  toast(msg, duration = 3000) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
  }
};

// Auto init
OSM.init();
