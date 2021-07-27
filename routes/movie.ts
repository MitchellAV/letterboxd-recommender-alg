import express from "express";
const router = express.Router();
import { cosine_similarity } from "../util/recommendation-functions";
import { matrix, zeros } from "mathjs";
import Movie from "../models/movie";
import { Movie as MovieType } from "../util/types";

router.post("/movie", async (req, res, next) => {
	const id = parseInt(req.body.id);
	const filterParams = req.body.params;
	const { num_per_page, page } = filterParams;

	// Get movie info to find recommendation for
	let target_movie: MovieType;
	try {
		target_movie = await Movie.findById(id).lean();
	} catch (err) {
		console.error(err);

		return next({
			message: "Could not find Movie in Database",
			status: 404,
			errors: []
		});
	}

	// Create map from tags for target movie
	let target_movie_tags = target_movie.tags;
	let target_movie_tags_to_index_map = new Map<string, number>();
	target_movie_tags.forEach((tag, i) => {
		target_movie_tags_to_index_map.set(tag, i);
	});

	const movies = req.app.get("MOVIES").filter((movie) => {
		let found = false;
		for (const tag of movie.tags) {
			const index = target_movie_tags_to_index_map.get(tag._id);
			if (index !== undefined) {
				found = true;
				break;
			}
		}
		return found;
	});

	// Get avg score from all movies in database
	let all_movies_average_score = await Movie.aggregate([
		{
			$group: {
				_id: "_id",
				average: {
					$avg: "$vote_average"
				}
			}
		}
	]);
	all_movies_average_score = all_movies_average_score[0].average;

	// Create Vector for target movie from tags
	let search_vector = matrix(zeros([1, target_movie_tags.length]), "sparse");
	target_movie.tags.forEach((tag) => {
		const index = target_movie_tags_to_index_map.get(tag);
		if (index !== undefined) {
			search_vector.set([0, index], 1);
		}
	});

	// Score all movies in database compared to the target movie vector
	let recommendations = [];
	for (let i = 0; i < movies.length; i++) {
		const movie = movies[i];

		// Create a vector for the movie in database
		let movieVector = matrix(
			zeros([1, target_movie_tags.length]),
			"sparse"
		);
		movie.tags.forEach((tag) => {
			const index = target_movie_tags_to_index_map.get(tag._id);
			if (index !== undefined) {
				let tfidf = tag.idf;
				let corrected_rating_average =
					(movie.vote_average * (movie.vote_count + 1)) /
					(movie.vote_count + 2);

				const correction =
					corrected_rating_average - all_movies_average_score;
				let ratingWeight = 0;
				if (correction >= 0) ratingWeight = Math.exp(correction);

				movieVector.set([0, index], tfidf * ratingWeight);
			}
		});
		let { score, maxIndex } = cosine_similarity(search_vector, movieVector);
		recommendations.push({
			...movie,
			score: score,
			maxTag: target_movie_tags[maxIndex]
		});

		if (i % 1000 == 0) {
			console.log(`${i}/${movies.length}`);
		}
	}

	recommendations = recommendations.sort((a, b) => b.score - a.score);
	const total = recommendations.length;
	recommendations = recommendations.slice(
		(page - 1) * num_per_page,
		(page - 1) * num_per_page + num_per_page
	);
	const total_pages = Math.ceil(total / num_per_page);
	return res.status(200).json({ recommendations, total, total_pages });
});
module.exports = router;
