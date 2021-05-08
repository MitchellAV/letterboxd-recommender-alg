const math = require("mathjs");
const cosine_similarity = (vectorA, vectorB) => {
	// vectorA = math.matrix(vectorA, "dense");
	// vectorB = math.matrix(vectorB, "dense");
	const a_norm = math.hypot(vectorA);
	const b_norm = math.hypot(vectorB);
	let search_vector = math.dotMultiply(vectorA, vectorB);
	let maxIndex = null;
	let maxValue = 0;
	search_vector.forEach((value, index) => {
		if (math.abs(value) > maxValue) {
			maxValue = math.abs(value);
			maxIndex = index[1];
		}
	});
	let score = math.sum(search_vector) / (a_norm * b_norm);
	// const dot_result = math.dot(
	// 	math.transpose(vectorA),
	// 	math.transpose(vectorB)
	// );
	// let score = dot_result / (a_norm * b_norm);
	if (isNaN(score)) {
		score = 0;
	}
	return { score, maxIndex };
};
module.exports = { cosine_similarity };
