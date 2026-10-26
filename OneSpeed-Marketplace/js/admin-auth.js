(function () {
  const loginUrl = '/admin/login';
  const redirectToLogin = () => {
    const requested = `${location.pathname}${location.search}`;
    location.replace(`${loginUrl}?redirect=${encodeURIComponent(requested)}`);
  };

  function ensureAdminNavigation() {
    const main = document.querySelector('main');
    if (!main) return;

    let layout = main.closest('.admin-layout');
    let sidebar = layout?.querySelector('.admin-sidebar');
    if (!layout) {
      layout = document.createElement('div');
      layout.className = 'admin-layout';
      main.parentNode.insertBefore(layout, main);
      layout.append(main);
    }
    if (!sidebar) {
      sidebar = document.createElement('aside');
      layout.insertBefore(sidebar, main);
    }

    sidebar.className = 'admin-sidebar';
    sidebar.setAttribute('aria-label', 'Administrator navigation');
    const links = [
      ['index.html', 'Dashboard'],
      ['products.html', 'Products'],
      ['orders.html', 'Orders'],
      ['bank-transfers.html', 'Bank transfers'],
      ['payouts.html', 'Seller payouts'],
      ['reviews.html', 'Review moderation'],
      ['support.html', 'Support queue'],
      ['delivery-zones.html', 'Delivery zones'],
      ['users.html', 'Seller applications']
    ];
    sidebar.replaceChildren(...links.map(([href, label]) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      if (location.pathname.endsWith(`/admin/${href}`)) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      return link;
    }));
    main.classList.add('admin-content');
  }

  function ensureAdminHeader() {
    const header = document.querySelector('.header');
    if (!header || header.querySelector('.header-inner')) return;
    header.innerHTML = `
      <div class="header-inner">
        <a href="/admin/" class="logo" aria-label="OneSpeed administrator workspace">
          <img src="/assets/images/onespeed-marketplace-brand.webp" alt="OneSpeed Marketplace" width="180" height="45">
        </a>
        <div class="nav-actions">
          <button class="btn btn-primary btn-sm" data-admin-logout type="button">Logout</button>
        </div>
      </div>`;
    header.querySelector('[data-admin-logout]').addEventListener('click', window.adminLogout);
  }

  window.OneSpeedAdmin = {
    ready: (async () => {
      document.documentElement.dataset.adminAuth = 'checking';
      try {
        if (!window.OneSpeedBackend?.configured()) {
          redirectToLogin();
          return null;
        }
        const user = await OneSpeedBackend.currentUser();
        const profile = user ? await OneSpeedBackend.profile() : null;
        if (!profile || profile.role !== 'admin' || !profile.is_active) {
          redirectToLogin();
          return null;
        }
        ensureAdminHeader();
        const actions = document.querySelector('.header .nav-actions');
        if (actions && !actions.querySelector('[data-admin-logout]')) {
          const button = document.createElement('button');
          button.className = 'btn btn-primary btn-sm';
          button.dataset.adminLogout = 'true';
          button.textContent = 'Logout';
          button.addEventListener('click', window.adminLogout);
          actions.append(button);
        }
        ensureAdminNavigation();
        document.documentElement.dataset.adminAuth = 'ready';
        return { user, profile };
      } catch (error) {
        console.error('Administrator authorization could not be verified.', error);
        redirectToLogin();
        return null;
      }
    })()
  };
})();

window.adminLogout = async function () {
  try {
    await window.OneSpeedBackend?.signOut();
    const response = await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not clear the administrator session.');
    window.OSM?.logout();
    location.replace('/admin/login');
  } catch (error) {
    console.error('Administrator sign-out failed.', error);
    alert('Could not sign out. Please try again.');
  }
};
