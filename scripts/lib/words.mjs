/* A count of one takes the singular: "1 close", "2 closes", "1 loss", "3 losses". */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
