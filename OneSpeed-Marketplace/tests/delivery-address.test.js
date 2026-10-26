const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class Element {
  constructor(value = '') {
    this.value = value;
    this.listeners = {};
    this.dataset = {};
    this.classList = { toggle() {} };
    this.hidden = false;
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  async fire(name, event = {}) {
    return this.listeners[name]?.(event);
  }
}

function addressForm() {
  const names = {
    fullName: new Element('Customer One'),
    phone: new Element('+2348000000000'),
    email: new Element('customer@example.test'),
    country: new Element('Nigeria'),
    state: new Element('Lagos'),
    city: new Element('Lagos'),
    address: new Element('12 Market Road'),
    zip: new Element('100001'),
    method: new Element('standard'),
    notes: new Element('')
  };
  Object.values(names).forEach(element => { element.name = 'field'; });
  const confirmButton = new Element();
  const form = {
    querySelector(selector) {
      const name = selector.match(/^\[name="(.+)"\]$/)?.[1];
      if (name) return names[name] || null;
      if (selector === '[data-confirm-delivery-address]') return confirmButton;
      return null;
    },
    querySelectorAll() {
      return Object.values(names);
    },
    reportValidity() {
      return ['country', 'city', 'address'].every(name => names[name].value.trim());
    }
  };
  return { form, names, confirmButton };
}

function loadAddressController({ leaflet = true } = {}) {
  const storage = new MemoryStorage();
  let mapOptions;
  let tileOptions;
  let clickHandler;
  let tileErrorHandler;
  const markers = [];
  const map = {
    setView(center, zoom) {
      mapOptions = { center, zoom };
      return this;
    },
    on(name, callback) {
      if (name === 'click') clickHandler = callback;
      return this;
    },
    invalidateSize() {}
  };
  const tiles = {
    addTo() { return this; },
    on(name, callback) {
      if (name === 'tileerror') tileErrorHandler = callback;
      return this;
    }
  };
  const L = {
    map() { return map; },
    tileLayer(url, options) {
      tileOptions = { url, ...options };
      return tiles;
    },
    marker(point, options) {
      const marker = {
        point,
        options,
        listeners: {},
        addTo() { markers.push(this); return this; },
        on(name, callback) { this.listeners[name] = callback; return this; },
        setLatLng(next) { this.point = next; },
        getLatLng() { return { lat: this.point[0], lng: this.point[1] }; }
      };
      return marker;
    }
  };
  const window = {
    localStorage: storage,
    setTimeout(callback) { callback(); },
    ...(leaflet ? { L } : {})
  };
  vm.runInNewContext(fs.readFileSync(path.join(project, 'js/delivery-address.js'), 'utf8'), { window, console });
  const formElements = addressForm();
  const mapElement = new Element();
  const statusElement = new Element();
  const mapMessageElement = new Element();
  const controller = window.OneSpeedDeliveryAddress.init({
    ...formElements,
    mapElement,
    statusElement,
    mapMessageElement
  });
  return {
    ...formElements,
    controller,
    mapOptions,
    mapMessageElement,
    markers,
    storage,
    statusElement,
    tileErrorHandler: () => tileErrorHandler?.(),
    tileOptions,
    clickMap: point => clickHandler?.({ latlng: point })
  };
}

test('renders an attributed OpenStreetMap tile layer and map controls', () => {
  const harness = loadAddressController();
  assert.deepEqual(JSON.parse(JSON.stringify(harness.mapOptions)), { center: [20, 0], zoom: 2 });
  assert.equal(harness.tileOptions.url, 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(harness.tileOptions.attribution, '© OpenStreetMap contributors');
  assert.equal(harness.tileOptions.maxZoom, 19);
});

test('map selection and marker dragging update the selected delivery coordinates', () => {
  const harness = loadAddressController();
  harness.clickMap({ lat: 6.5244, lng: 3.3792 });
  assert.equal(harness.markers.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.controller.getCoordinates())), { latitude: 6.5244, longitude: 3.3792 });
  harness.markers[0].point = [6.5301, 3.381];
  harness.markers[0].listeners.dragend();
  assert.deepEqual(JSON.parse(JSON.stringify(harness.controller.getCoordinates())), { latitude: 6.5301, longitude: 3.381 });
});

test('confirms and saves the entered address together with selected coordinates', async () => {
  const harness = loadAddressController();
  harness.clickMap({ lat: 6.5244, lng: 3.3792 });
  await harness.confirmButton.fire('click');
  const saved = JSON.parse(harness.storage.getItem('osm_delivery_address'));
  assert.equal(saved.address, '12 Market Road');
  assert.equal(saved.city, 'Lagos');
  assert.equal(saved.state, 'Lagos');
  assert.equal(saved.country, 'Nigeria');
  assert.equal(saved.latitude, 6.5244);
  assert.equal(saved.longitude, 3.3792);
  assert.equal(harness.controller.getConfirmedAddress().latitude, 6.5244);
  assert.equal(harness.statusElement.textContent, 'Delivery address confirmed.');
});

test('keeps manual confirmation available and reports map tile failures', async () => {
  const unavailable = loadAddressController({ leaflet: false });
  assert.equal(unavailable.mapMessageElement.hidden, false);
  assert.match(unavailable.mapMessageElement.textContent, /manually/);
  await unavailable.confirmButton.fire('click');
  assert.equal(unavailable.controller.getConfirmedAddress().address, '12 Market Road');
  assert.equal(unavailable.controller.getConfirmedAddress().latitude, undefined);

  const tileFailure = loadAddressController();
  tileFailure.tileErrorHandler();
  assert.equal(tileFailure.mapMessageElement.hidden, false);
  assert.match(tileFailure.mapMessageElement.textContent, /tiles are temporarily unavailable/);
});

test('surfaces fee quote errors without leaving an unhandled confirmation rejection', async () => {
  const storage = new MemoryStorage();
  const window = { localStorage: storage, setTimeout() {} };
  const errors = [];
  vm.runInNewContext(fs.readFileSync(path.join(project, 'js/delivery-address.js'), 'utf8'), {
    window,
    console: { error: (...args) => errors.push(args) }
  });
  const { form, confirmButton } = addressForm();
  const statusElement = new Element();
  const mapMessageElement = new Element();
  window.OneSpeedDeliveryAddress.init({
    form,
    statusElement,
    mapMessageElement,
    onConfirm: async () => { throw new Error('Delivery fee service unavailable'); }
  });
  await assert.doesNotReject(confirmButton.fire('click'));
  assert.match(statusElement.textContent, /delivery fees could not be checked/);
  assert.ok(storage.getItem('osm_delivery_address'));
  assert.equal(errors.length, 1);
});

test('persists confirmed address data in local orders and forwards it to Supabase order RPC', async () => {
  const storage = new MemoryStorage();
  const localWindow = { localStorage: storage };
  const localContext = { window: localWindow, localStorage: storage, document: {} };
  vm.runInNewContext(fs.readFileSync(path.join(project, 'js/data.js'), 'utf8'), localContext);
  const shipping = { address: '12 Market Road', city: 'Lagos', country: 'Nigeria', latitude: 6.5244, longitude: 3.3792 };
  localContext.shipping = shipping;
  vm.runInNewContext('OSM.createOrder({ shipping })', localContext);
  const savedOrder = JSON.parse(storage.getItem('osm_orders'))[0];
  assert.deepEqual(JSON.parse(JSON.stringify(savedOrder.shipping)), shipping);

  let rpcCall;
  const orderResponse = { id: 'order-id' };
  const backendWindow = {
    ONESPEED_SUPABASE_CONFIG: { url: 'https://project.supabase.co', anonKey: 'public-anon-key' },
    supabase: {
      createClient() {
        return { async rpc(name, args) { rpcCall = { name, args }; return { data: orderResponse, error: null }; } };
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(project, 'js/supabase.js'), 'utf8'), { window: backendWindow, console });
  const result = await backendWindow.OneSpeedBackend.placeOrder({
    items: [{ productId: 'product-id', quantity: 2 }],
    shippingAddress: shipping,
    currency: 'NGN',
    shippingAmount: 5.99
  });
  assert.equal(result, orderResponse);
  assert.equal(rpcCall.name, 'place_order');
  assert.equal(rpcCall.args.p_shipping_address.latitude, shipping.latitude);
  assert.equal(rpcCall.args.p_shipping_address.longitude, shipping.longitude);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCall.args.p_items)), [{ product_id: 'product-id', quantity: 2 }]);
  assert.equal(rpcCall.args.p_shipping_amount, 0);
});

test('preserves Supabase UUID product IDs in the existing cart state', () => {
  const storage = new MemoryStorage();
  const context = { window: { localStorage: storage }, localStorage: storage, document: {} };
  vm.runInNewContext(fs.readFileSync(path.join(project, 'js/data.js'), 'utf8'), context);
  vm.runInNewContext(`
    OSM.saveProducts([{ id: 'd9428888-122b-4e7f-9d78-9d9e5f122a14', price: 12, currency: 'NGN' }]);
    OSM.addToCart('d9428888-122b-4e7f-9d78-9d9e5f122a14', 1);
    OSM.addToCart('d9428888-122b-4e7f-9d78-9d9e5f122a14', 2);
  `, context);
  const cart = JSON.parse(storage.getItem('osm_cart'));
  assert.deepEqual(cart, [{ productId: 'd9428888-122b-4e7f-9d78-9d9e5f122a14', qty: 3 }]);
});
