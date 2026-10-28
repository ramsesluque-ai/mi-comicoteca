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

  // Last-loaded handler wins: prevents later legacy scripts from leaving the
  // Dashboard button highlighted while another view remains rendered.
  document.querySelectorAll('.nav button[data-v]').forEach(btn => {
    btn.onclick = async () => {
      const view = btn.dataset.v;
      if (!view) return;
      seriesReturn = null;
      editingFromSeries = false;
      current = view;
      page = 1;
      filters = {};
      masterCollection = null;
      setNav(view);
      await render();
      setNav(view);
    };
  });
})();
