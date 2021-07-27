import math from "mathjs";
import { User, UserMovie } from "../util/types";
export const update_user_movies = (movieArray, username) => {
	const newUser: User = {
		_id: username,
		movies: [],
		watchList: [],
		following: [],
		status: "success"
	};
	if (movieArray.length !== 0) {
		let ratings = movieArray
			.map((movie) => movie.rating)
			.filter((rating) => rating !== null);
		let avg = math.mean(ratings) || 1;
		movieArray.forEach((movie) => {
			const movieObj: UserMovie = {
				_id: movie._id,
				rating: movie.rating || avg
			};
			if (!isNaN(movieObj._id)) {
				newUser.movies.push(movieObj);
			}
		});
	}
	return newUser;
};
