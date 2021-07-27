import express from "express";
import { body, validationResult } from "express-validator";
const router = express.Router();
import math from "mathjs";
import Movie from "../models/movie";
import User from "../models/user";
import Tag from "../models/tag";
import { update_user_movies } from "../util/api_helper";
import {
	getLetterboxdUserMovies,
	isRealLetterboxdUser
} from "../util/getletterboxd";
import {
	reset_user_recommendations,
	get_user_movie_tags,
	calc_tfidf
} from "../util/user-recommendation";
import { update_user_status } from "../util/database-functions";
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
				errors: errors.array()
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
					errors: []
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
						errors: []
					});
				}

				// If check if user is real
				if (userExists) {
					let movieArray;
					try {
						movieArray = await getLetterboxdUserMovies(username);
					} catch (err) {
						console.error(err);
						return next({
							message:
								"Unable to determine get user movies from letterboxd",
							status: 500,
							errors: []
						});
					}

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
								errors: statusErr
							});
						return next({
							message: "Unable to to save user to database",
							status: 500,
							errors: []
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
						errors: []
					});
				}
			} else {
				if (user_profile.status === "working") {
					return next({
						message:
							"Currently in progress of creating recommendations for user",
						status: 500,
						errors: []
					});
				} else {
					const [status, statusErr] = await update_user_status(
						username,
						"working"
					);
				}

				let movieArray;
				try {
					movieArray = await getLetterboxdUserMovies(username);
				} catch (err) {
					const [status, statusErr] = await update_user_status(
						username,
						"failed"
					);

					return next({
						message:
							"Unable to get user's movies from letterboxd.com",
						status: 500,
						errors: []
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

					return next({
						message: "Unable to save user to database",
						status: 500,
						errors: []
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
				errors: errors.array()
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
					errors: []
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
					errors: []
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
			let user_movie_ratings_map = new Map<string, number>();
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

module.exports = router;
