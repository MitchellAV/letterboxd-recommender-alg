const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();
const math = require("mathjs");
const Movie = require("../models/movie");
const User = require("../models/user");
const Tag = require("../models/tag");
const { update_user_movies } = require("../util/api_helper");
const {
	getLetterboxdUserMovies,
	isRealLetterboxdUser
} = require("../util/getletterboxd");
const { cosine_similarity } = require("../util/recommendation-functions");
const {
	reset_user_recommendations,
	get_user_movie_tags,
	calc_tfidf
} = require("../util/user-recommendation");
const { update_user_status } = require("../util/database-functions");
const tag_blacklist = [
	"aftercreditsstinger",
	"duringcreditsstinger",
	"based on novel or book",
	// "woman director",
	"anime"
	// "based on young adult novel",
	// "live action and animation",
	// "female protagonist"
];

router.post(
	"/user/movies",
	[
		body("username", "Please enter your letterboxd username.")
			.trim()
			.isLength({ min: 1 })
			.toLowerCase()
			.escape(),
		body("accuracy", "").trim().escape().isIn(["high", "med", "low"])
	],
	async (req, res, next) => {
		const errors = validationResult(req);

		if (!errors.isEmpty()) {
			// There are errors. Render form again with sanitized values/errors messages.
			// Error messages can be returned in an array using `errors.array()`.

			return next({
				message: "Please fix the following fields:",
				status: 400,
				error: errors.array()
			});
		} else {
			const { username, accuracy } = req.body;
			let user_profile;
			try {
				user_profile = await User.findById(username).lean();
			} catch (err) {
				return next({
					message: "Unable to get find user in database",
					status: 404,
					error: err
				});
			}
			// Does user Exist in Database
			if (!user_profile) {
				// If user does not exist in database then check if username is real letterboxd user
				// if user is real get movies else dont
				let userExists;
				try {
					userExists = await isRealLetterboxdUser(username);
				} catch (err) {
					return next({
						message: "Unable to determine if user is real or not",
						status: 500,
						error: err
					});
				}

				// If check if user is real
				if (userExists) {
					const movieArray = await getLetterboxdUserMovies(username);
					// user is real
					const newUser = update_user_movies(movieArray, username);
					const userToSave = new User(newUser);
					try {
						// save user to database users collection
						await userToSave.save();
					} catch (err) {
						const [status, statusErr] = await update_user_status(
							username,
							"failed"
						);
						if (statusErr)
							return next({
								message:
									"Unable to connect to database to change user status",
								status: 500,
								error: statusErr
							});
						return next({
							message: "Unable to to save user to database",
							status: 500,
							error: err
						});
					}
					const [status, statusErr] = await update_user_status(
						username,
						"working"
					);
					if (statusErr)
						return next({
							message:
								"Unable to connect to database to change user status",
							status: 500,
							error: statusErr
						});
				} else {
					return next({
						message: "Letterboxd user does not exist",
						status: 404,
						error: []
					});
				}
			} else {
				if (user_profile.status === "working") {
					return next({
						message:
							"Currently in progress of creating recommendations for user",
						status: 500,
						error: []
					});
				} else {
					const [status, statusErr] = await update_user_status(
						username,
						"working"
					);
					if (statusErr)
						return next({
							message:
								"Unable to connect to database to change user status",
							status: 500,
							error: statusErr
						});
				}

				let movieArray;
				try {
					movieArray = await getLetterboxdUserMovies(username);
				} catch (err) {
					const [status, statusErr] = await update_user_status(
						username,
						"failed"
					);
					if (statusErr)
						return next({
							message:
								"Unable to connect to database to change user status",
							status: 500,
							error: statusErr
						});
					return next({
						message:
							"Unable to get user's movies from letterboxd.com",
						status: 500,
						error: err
					});
				}
				// user is real
				const newUser = update_user_movies(movieArray, username);

				try {
					// add users movies to user in database
					await User.updateOne({ _id: username }, newUser);
				} catch (err) {
					console.error(err);
					const [status, statusErr] = await update_user_status(
						username,
						"failed"
					);
					if (statusErr)
						return next({
							message:
								"Unable to connect to database to change user status",
							status: 500,
							error: statusErr
						});
					return next({
						message: "Unable to save user to database",
						status: 500,
						error: err
					});
				}
			}
			return res.status(200).json({
				status: 200,
				message: "Successfully updated users movies"
			});
		}
	}
);

router.post(
	"/user/recommend",
	[
		body("username", "Please enter your letterboxd username.")
			.trim()
			.isLength({ min: 1 })
			.escape(),

		body(
			"accuracy",
			"Please select how accurate you want your recommendations to be."
		).isIn(["high", "med", "low"])
	],
	async (req, res, next) => {
		const errors = validationResult(req);

		if (!errors.isEmpty()) {
			// There are errors. Render form again with sanitized values/errors messages.
			// Error messages can be returned in an array using `errors.array()`.
			console.log(errors);

			return next({
				message: "Please fix the following fields:",
				status: 400,
				error: errors.array()
			});
		} else {
			const username = req.body.username;
			try {
				await reset_user_recommendations(username);
			} catch (err) {
				const [status, statusErr] = await update_user_status(
					username,
					"failed"
				);
				return next({
					message: "Unable to reset recommendations",
					status: 500,
					error: err
				});
			}
			let user_profile;
			try {
				user_profile = await User.findById(username).lean();
			} catch (err) {
				const [status, statusErr] = await update_user_status(
					username,
					"failed"
				);
				return next({
					message: "Unable to find user in database",
					status: 404,
					error: err
				});
			}
			const user_movie_ids = user_profile.movies.map(
				(movie) => movie._id
			);

			const [user_tags, user_tags_to_idf_map] = await get_user_movie_tags(
				user_movie_ids,
				tag_blacklist
			);

			const tags_to_index_map = new Map();
			user_tags.forEach((tag, i) => {
				tags_to_index_map.set(tag, i);
			});

			const general_tags = await Tag.aggregate([
				{
					$match: {
						$expr: {
							$in: ["$_id", user_tags]
						}
					}
				}
			]);

			const movie_tags_to_idf_map = new Map();
			general_tags.forEach((tag) => {
				movie_tags_to_idf_map.set(tag._id, tag.idf);
			});

			const movies = req.app.get("MOVIES").filter((movie) => {
				let found = false;
				for (const tag of movie.tags) {
					const index = tags_to_index_map.get(tag._id);
					if (index !== undefined) {
						found = true;
						break;
					}
				}
				return found;
			});

			const user_movie_ratings = user_profile.movies.map(
				(movie) => movie.rating
			);
			let avg_user_movie_rating = math.mean(user_movie_ratings);

			let user_movies = movies.filter((movie) =>
				user_movie_ids.includes(movie._id)
			);
			let user_movie_ratings_map = new Map();
			user_movie_ids.forEach((id, i) => {
				user_movie_ratings_map.set(id, user_movie_ratings[i]);
			});
			// usermovies = fullusermovies.map((movie) => {
			// 	return { ...movie, userRating: user_movie_ratings_map.get(movie._id) };
			// });

			// add user rating to movies object
			let alluservectors = [];
			for (let i = 0; i < user_movies.length; i++) {
				let movie = user_movies[i];

				movie = {
					...movie,
					userRating: user_movie_ratings_map.get(movie._id)
				};

				let movieVector = math.matrix(
					math.zeros([1, user_tags.length]),
					"sparse"
				);
				movie.tags.forEach((tag) => {
					const index = tags_to_index_map.get(tag._id);
					if (index !== undefined) {
						// avg_user_movie_rating
						let tfidf = user_tags_to_idf_map.get(tag._id);
						const correction =
							movie.userRating - avg_user_movie_rating;
						let ratingWeight = 0;
						if (correction >= 0)
							ratingWeight = Math.exp(correction);
						movieVector.set([0, index], tfidf * ratingWeight);
					}
				});
				alluservectors.push(movieVector);
			}
			let search_vector = math.multiply(
				math.apply(alluservectors, 0, math.sum),
				1 / alluservectors.length
			);

			let all_movies_average = await Movie.aggregate([
				{
					$group: {
						_id: "_id",
						average: {
							$avg: "$vote_average"
						}
					}
				}
			]);
			all_movies_average = all_movies_average[0].average;
			// let recommendedMovies = [];

			let writes = [];

			let maxAsync = 1000;

			for (let i = 0; i < movies.length; i++) {
				const movie = movies[i];

				writes.push(
					calc_tfidf(
						username,
						movie,
						user_tags,
						tags_to_index_map,
						all_movies_average,
						search_vector
					)
				);

				if (i % maxAsync == 0) {
					console.log(`${i}/${movies.length}`);
					// await Promise.all(writes);
					await Movie.bulkWrite(writes);
					writes = [];
				}
			}
			await Movie.bulkWrite(writes);
			const [status, statusErr] = await update_user_status(
				username,
				"success"
			);
			return res.status(200).json({
				status: 200,
				message: "Successfully updated users recommendations"
			});
		}
	}
);

router.post("/movie", async (req, res, next) => {
	const id = parseInt(req.body.id);
	const filterParams = req.body.params;
	const { num_per_page, page, filter } = filterParams;

	// const movies = req.app.get("MOVIES").filter((movie) => {
	// 	return filter ? movie.filter.includes(filter) : true;
	// });

	// Get movie info to find recommendation for
	let target_movie;
	try {
		target_movie = await Movie.findById(id).lean();
	} catch (err) {
		return next({
			message: "Could not find Movie in Database",
			status: 404,
			error: err
		});
	}

	// Create map from tags for target movie
	let target_movie_tags = target_movie.tags;
	let target_movie_tags_to_index_map = new Map();
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
	let search_vector = math.matrix(
		math.zeros([1, target_movie_tags.length]),
		"sparse"
	);
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
		let movieVector = math.matrix(
			math.zeros([1, target_movie_tags.length]),
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
