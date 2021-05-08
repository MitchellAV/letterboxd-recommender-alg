const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();
const math = require("mathjs");
const Movie = require("../models/movie");
const User = require("../models/user");
const { update_user_movies } = require("../api_helper");
const {
	getLetterboxdUserMovies,
	isRealLetterboxdUser
} = require("../getletterboxd");
const { cosine_similarity } = require("../util/recommendation-functions");
const {
	new_or_update_user,
	reset_user_recommendations,
	get_user_movie_tags,
	determine_accuracy,
	calc_tfidf
} = require("../util/user-recommendation");
const tag_blacklist = [
	"aftercreditsstinger",
	"duringcreditsstinger",
	"based on novel or book",
	"woman director"
];

router.post(
	"/update",
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
	async (req, res) => {
		const errors = validationResult(req);
		console.log(errors);
		let data = {
			msg: "",
			errors: []
		};

		if (!errors.isEmpty()) {
			// There are errors. Render form again with sanitized values/errors messages.
			// Error messages can be returned in an array using `errors.array()`.
			console.log(errors);
			data.msg = "Please fix the following fields:";
			data.errors = errors.array();
			return res.status(400).json(data);
		} else {
			const username = req.body.username;
			const accuracy = req.body.accuracy;
			let user_profile;
			try {
				user_profile = await User.findById(username).lean();
			} catch (err) {
				console.log(err);

				return res
					.status(500)
					.json({ msg: "Unable to get data from database" });
			}
			// Does user Exist in Database
			if (!user_profile) {
				// If user does not exist in database then check if username is real letterboxd user
				// if user is real get movies else dont
				let userExists = await isRealLetterboxdUser(username);

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
						console.error(err);
						return res
							.status(500)
							.json({ msg: "Unable to save user to database" });
					}
				} else {
					console.log("user does not exist");
					return res
						.status(400)
						.json({ msg: "Letterboxd user does not exist" });
				}
			} else {
				const movieArray = await getLetterboxdUserMovies(username);
				// user is real
				const newUser = update_user_movies(movieArray, username);

				try {
					// add users movies to user in database
					await User.updateOne({ _id: username }, newUser);
				} catch (err) {
					console.error(err);
					return res
						.status(500)
						.json({ msg: "Unable to save user to database" });
				}
			}

			await reset_user_recommendations(username);

			user_profile = await User.findById(username).lean();
			const user_movie_ids = user_profile.movies.map(
				(movie) => movie._id
			);

			const movies = req.app.get("MOVIES");

			const [
				all_movies_tags,
				all_movies_tags_map
			] = await determine_accuracy(
				username,
				accuracy,
				movies,
				tag_blacklist
			);

			const [user_tags, user_tag_map] = await get_user_movie_tags(
				user_movie_ids,
				all_movies_tags_map
			);

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
					math.zeros([1, all_movies_tags.length]),
					"sparse"
				);
				movie.tags.forEach((tag) => {
					const index = all_movies_tags_map.get(tag._id);
					if (index !== undefined) {
						// avg_user_movie_rating
						let tfidf = user_tag_map.get(tag._id);
						let ratingWeight = Math.pow(
							movie.userRating / avg_user_movie_rating,
							5
						);
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

			let maxAsync = 10000;

			for (let i = 0; i < movies.length; i++) {
				const movie = movies[i];

				writes.push(
					calc_tfidf(
						username,
						movie,
						all_movies_tags,
						all_movies_tags_map,
						all_movies_average,
						search_vector
					)
				);

				if (i % maxAsync == 0) {
					// await Promise.all(writes);
					console.log(`${i}/${movies.length}`);
					// await Movie.bulkWrite(writes);
					// writes = [];
				}
			}
			await Movie.bulkWrite(writes);
			// await User.updateOne(
			// 	{ _id: username },
			// 	{ $set: { recommended: recommendedMovies } }
			// );
			// await Movie.aggregate([
			// 	{
			// 		$match: {
			// 			$expr: {
			// 				$and: [
			// 					{
			// 						$in: [username, "$score._id"]
			// 					}
			// 				]
			// 			}
			// 		}
			// 	},
			// 	{
			// 		$addFields: {
			// 			score: {
			// 				$filter: {
			// 					input: "$score",
			// 					as: "el",
			// 					cond: {
			// 						$eq: ["$$el._id", username]
			// 					}
			// 				}
			// 			}
			// 		}
			// 	},
			// 	{
			// 		$set: {
			// 			score: {
			// 				$arrayElemAt: ["$score", 0]
			// 			}
			// 		}
			// 	},
			// 	{
			// 		$lookup: {
			// 			from: "users",
			// 			let: {
			// 				movie_id: "$_id",
			// 				user_id: "$score._id"
			// 			},
			// 			pipeline: [
			// 				{
			// 					$match: {
			// 						$expr: {
			// 							$eq: ["$$user_id", "$_id"]
			// 						}
			// 					}
			// 				},
			// 				{
			// 					$unwind: {
			// 						path: "$recommended"
			// 					}
			// 				},
			// 				{
			// 					$match: {
			// 						$expr: {
			// 							$eq: ["$$movie_id", "$recommended._id"]
			// 						}
			// 					}
			// 				},
			// 				{
			// 					$project: {
			// 						"recommended.score": 1
			// 					}
			// 				},
			// 				{
			// 					$set: {
			// 						score: "$recommended.score"
			// 					}
			// 				},
			// 				{
			// 					$unset: ["recommended"]
			// 				}
			// 			],
			// 			as: "score.score"
			// 		}
			// 	},
			// 	{
			// 		$set: {
			// 			"score.score": {
			// 				$arrayElemAt: ["$score.score", 0]
			// 			}
			// 		}
			// 	},
			// 	{
			// 		$set: {
			// 			"score.score": "$score.score.score"
			// 		}
			// 	}
			// ]);
			// recommendedMovies = recommendedMovies.sort(
			// 	(a, b) => b.score - a.score
			// );
			res.status(200).json({ msg: "Recommendation successful" });
		}
	}
);

router.post("/movie", async (req, res) => {
	const id = parseInt(req.body.id);
	const filterParams = req.body.params;
	const { num_per_page, page, filter } = filterParams;

	const movies = req.app.get("MOVIES").filter((movie) => {
		return filter ? movie.filter.includes(filter) : true;
	});

	// Get movie info to find recommendation for
	let target_movie;
	try {
		target_movie = await Movie.findById(id).lean();
	} catch (err) {
		console.error(err);
		return res.status(404).json({ msg: "No movie in database" });
	}

	// Create map from tags for target movie
	let target_movie_tags = target_movie.tags;
	let target_movie_tags_map = new Map();
	target_movie_tags.forEach((tag, i) => {
		target_movie_tags_map.set(tag, i);
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
		const index = target_movie_tags_map.get(tag);
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
			const index = target_movie_tags_map.get(tag._id);
			if (index !== undefined) {
				let tfidf = tag.idf;
				let corrected_vote_average =
					(movie.vote_count * movie.vote_average +
						movie.vote_average +
						0) /
					(movie.vote_count + 2);
				let ratingWeight = Math.pow(
					corrected_vote_average / all_movies_average_score,
					5
				);
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
	recommendations = recommendations.slice(
		page * num_per_page,
		page * num_per_page + num_per_page
	);
	return res.status(200).json({ recommendations });
});
module.exports = router;
