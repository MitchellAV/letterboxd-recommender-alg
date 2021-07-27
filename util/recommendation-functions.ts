import { hypot, dotMultiply, abs, sum, Matrix } from "mathjs";
export const cosine_similarity = (vectorA: Matrix, vectorB: Matrix) => {
  const a_norm = hypot(vectorA);
  const b_norm = hypot(vectorB);
  let search_vector = dotMultiply(vectorA, vectorB);
  let maxIndex = null;
  let maxValue = 0;
  search_vector.forEach((value, index) => {
    if (abs(value) > maxValue) {
      maxValue = abs(value);
      maxIndex = index[1];
    }
  });
  let score = sum(search_vector) / (a_norm * b_norm);
  if (isNaN(score)) {
    score = 0;
  }
  return { score, maxIndex };
};
