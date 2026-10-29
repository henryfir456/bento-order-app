// SweetAlert2 is only needed once a dialog opens, so it loads on first use instead of in the main bundle.
let loading;
const load = () => (loading ||= Promise.all([
  import('sweetalert2'),
  import('sweetalert2/dist/sweetalert2.min.css')
]).then(([mod]) => mod.default));

const Swal = { fire: async (...args) => (await load()).fire(...args) };

export default Swal;
