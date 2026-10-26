(function (root) {
  const STORAGE_KEY = 'osm_delivery_address';
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '© OpenStreetMap contributors';

  function readSavedAddress(storage = root.localStorage) {
    const value = storage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  }

  function init({ form, mapElement, statusElement, mapMessageElement, initialAddress, onConfirm }) {
    const fields = ['fullName', 'phone', 'email', 'country', 'state', 'city', 'address', 'zip', 'method', 'notes'];
    const controls = Object.fromEntries(fields.map(name => [name, form.querySelector(`[name="${name}"]`)]));
    const initial = initialAddress || readSavedAddress();
    let coordinates = null;
    let marker = null;
    let map = null;
    let confirmedAddress = null;

    if (initial) {
      fields.forEach(name => {
        if (controls[name] && !controls[name].value && initial[name]) controls[name].value = initial[name];
      });
      if (initial.latitude !== undefined && initial.latitude !== null && initial.longitude !== undefined && initial.longitude !== null
        && Number.isFinite(Number(initial.latitude)) && Number.isFinite(Number(initial.longitude))
        && Number(initial.latitude) >= -90 && Number(initial.latitude) <= 90
        && Number(initial.longitude) >= -180 && Number(initial.longitude) <= 180) {
        coordinates = { latitude: Number(initial.latitude), longitude: Number(initial.longitude) };
      }
    }

    function setMessage(message, isError = false) {
      statusElement.textContent = message;
      statusElement.classList.toggle('is-error', isError);
    }

    function invalidateConfirmation() {
      confirmedAddress = null;
      setMessage('Confirm your address before placing the order.');
    }

    function setCoordinates(latitude, longitude) {
      coordinates = { latitude, longitude };
      if (!marker) {
        marker = root.L.marker([latitude, longitude], { draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const point = marker.getLatLng();
          coordinates = { latitude: point.lat, longitude: point.lng };
          invalidateConfirmation();
        });
      } else {
        marker.setLatLng([latitude, longitude]);
      }
      invalidateConfirmation();
    }

    form.querySelectorAll('[name="fullName"], [name="phone"], [name="country"], [name="state"], [name="city"], [name="address"], [name="zip"]').forEach(control => {
      control.addEventListener('input', invalidateConfirmation);
      control.addEventListener('change', invalidateConfirmation);
    });

    const confirmButton = form.querySelector('[data-confirm-delivery-address]');
    confirmButton.addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      if (confirmButton.disabled) return;
      const address = Object.fromEntries(fields
        .filter(name => controls[name])
        .map(name => [name, controls[name].value.trim()]));
      if (coordinates) Object.assign(address, coordinates);
      confirmButton.disabled = true;
      try {
        if (onConfirm) {
          await onConfirm({ ...address });
        }
        confirmedAddress = address;
        root.localStorage.setItem(STORAGE_KEY, JSON.stringify(address));
        setMessage('Delivery address confirmed.');
      } catch (error) {
        confirmedAddress = null;
        setMessage('The delivery address could not be confirmed. Check delivery availability and try again.', true);
        console.error('OneSpeed: delivery address confirmation callback failed.', error);
      } finally {
        confirmButton.disabled = false;
      }
    });

    if (!root.L || !mapElement) {
      mapMessageElement.textContent = 'The map could not be loaded. You can still enter and confirm your address manually.';
      mapMessageElement.hidden = false;
    } else {
      try {
        const center = coordinates ? [coordinates.latitude, coordinates.longitude] : [20, 0];
        map = root.L.map(mapElement).setView(center, coordinates ? 15 : 2);
        const tiles = root.L.tileLayer(TILE_URL, {
          attribution: ATTRIBUTION,
          maxZoom: 19
        }).addTo(map);
        tiles.on('tileerror', () => {
          mapMessageElement.textContent = 'Map tiles are temporarily unavailable. You can still enter and confirm your address manually.';
          mapMessageElement.hidden = false;
        });
        if (coordinates) {
          marker = root.L.marker([coordinates.latitude, coordinates.longitude], { draggable: true }).addTo(map);
          marker.on('dragend', () => {
            const point = marker.getLatLng();
            coordinates = { latitude: point.lat, longitude: point.lng };
            invalidateConfirmation();
          });
        }
        map.on('click', event => setCoordinates(event.latlng.lat, event.latlng.lng));
        root.setTimeout(() => map.invalidateSize(), 0);
      } catch (error) {
        console.error('OneSpeed: delivery map failed to initialize.', error);
        mapMessageElement.textContent = 'The map could not be loaded. You can still enter and confirm your address manually.';
        mapMessageElement.hidden = false;
      }
    }

    setMessage('Confirm your address before placing the order.');
    return {
      getConfirmedAddress: () => confirmedAddress && { ...confirmedAddress },
      getCoordinates: () => coordinates && { ...coordinates }
    };
  }

  root.OneSpeedDeliveryAddress = { init, readSavedAddress, storageKey: STORAGE_KEY };
})(window);
