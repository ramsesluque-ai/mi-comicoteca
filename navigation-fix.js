'use strict';
// Commercial navigation guard. Keeps the v71 production branch untouched.
(() => {
  let seriesReturn = null;
  let editingFromSeries = false;
  let reopeningSeries = false;

  const baseOpenSeries = window.openSeries;
  const baseEditComic = window.editComic;
  const baseCloseModal = window.closeModal;

  // Remember the exact collection before opening one of its issue cards.
  if (typeof baseOpenSeries === 'function') {
    window.openSeries = async function(encoded) {
      seriesReturn = encoded;
      editingFromSeries = false;
      return baseOpenSeries(encoded);
    };
  }

  if (typeof baseEditComic === 'function') {
    window.editComic = async function(id) {
      const modal = document.querySelector('#modal');
      const fromSeries = !!(seriesReturn && modal && !modal.classList.contains('hidden') && modal.querySelector('.issue-grid'));
      editingFromSeries = fromSeries;
      return baseEditComic(id);
    };
  }

  // Closing/cancelling/saving a comic opened from a collection returns to that
  // same collection instead of dropping the user at the collections index.
  if (typeof baseCloseModal === 'function') {
    window.closeModal = function() {
      baseCloseModal();
      if (editingFromSeries && seriesReturn && !reopeningSeries) {
        const target = seriesReturn;
        editingFromSeries = false;
        reopeningSeries = true;
        Promise.resolve(window.openSeries(target)).finally(() => { reopeningSeries = false; });
      }
    };
  }


  // Migration copies ONLY locally stored covers; it does not migrate comic records.
  // Keep this optional, explicit operation under Data / backups, not as a top-level action.
  if (typeof window.backupView === 'function') {
    const originalBackupView = window.backupView;
    window.backupView = async function(...args) {
      const html = await originalBackupView.apply(this, args);
      return html + '<div class="card" style="margin-top:16px"><h3>Portadas privadas en la nube (opcional)</h3><p class="muted">Copia únicamente las portadas guardadas en este dispositivo a tu espacio privado de Supabase. No traslada fichas ni modifica el catálogo; conserva los originales locales. Requiere iniciar sesión y comprobar los permisos antes de utilizarlo.</p><button type="button" class="btn" onclick="window.CloudMigration?.show()">Copiar portadas privadas</button></div>';
    };
  }

  // Last-loaded handler wins: prevents later legacy scripts from leaving the
  // Dashboard button highlighted while another view remains rendered.
  let navigationSequence = 0;
  document.querySelectorAll('.nav button[data-v]').forEach(btn => {
    btn.onclick = async () => {
      const view = btn.dataset.v;
      if (!view) return;
      const sequence = ++navigationSequence;
      seriesReturn = null;
      editingFromSeries = false;
      current = view;
      page = 1;
      filters = {};
      masterCollection = null;
      setNav(view);
      try {
        await render();
        // An older asynchronous navigation must never leave the Maestro button
        // highlighted over a stale Collections screen.
        if (sequence !== navigationSequence) return;
        if (view === 'master') {
          const title = document.querySelector('#view h1');
          if (!title || !/maestro/i.test(title.textContent || '')) {
            await render();
          }
          if (sequence !== navigationSequence) return;
          const body = document.getElementById('masterbody');
          if (!body) throw Error('La pantalla Maestro no se ha montado correctamente');
          if (!body.children.length || !body.textContent.trim()) {
            body.innerHTML = '<p role="alert">El Maestro no ha podido mostrar sus resultados. Vuelve a pulsar Maestro para reintentar.</p>';
          }
        }
        setNav(view);
      } catch (err) {
        console.error('[Navegación] Error al abrir '+view, err);
        if (sequence !== navigationSequence) return;
        const root = document.getElementById('view');
        if (root) root.innerHTML = '<section class="panel" role="alert"><h1>No se pudo abrir '+(view === 'master' ? 'Maestro' : 'esta sección')+'</h1><p>Ha fallado la carga. Tus datos no se han modificado.</p><button class="btn" type="button" id="mc-nav-retry">Reintentar</button></section>';
        document.getElementById('mc-nav-retry')?.addEventListener('click', () => btn.click(), {once:true});
        setNav(view);
      }
    };
  });
})();
