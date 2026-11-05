/** Texto de confirmación que dice cuánta carga académica se pierde al eliminar. */
export const rowsLabel = (n: number) =>
  n === 0 ? 'Sí, eliminar' : `Sí, eliminar con ${n} ${n === 1 ? 'clase' : 'clases'} de la carga`;
