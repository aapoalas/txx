/*
 * I Made a POSIX Semaphore Wrapper and I'm So Sorry
 *
 * by imaami: https://gist.github.com/imaami/4744a322a53d6765124c472193b22067
 *
 * Compile with -std=c++20 or later. Example of use:
 *
 *   ::sem_t *sem = new named_sem<"/when_you_see_it",
 *                                O_CREAT | O_RDWR,
 *                                0666, 0>();
 *   if (sem) {
 *           sem->post();
 *           delete sem;
 *   }
 */
#ifndef NAMED_SEM_HPP_
#define NAMED_SEM_HPP_

#include <algorithm>
#include <cstddef>
#include <new>
#include <semaphore.h>
#include <sys/stat.h>

template<std::size_t N>
struct fixed_str
{
	char buf[N]{};
	constexpr fixed_str(char const (&s)[N]) noexcept {
		std::copy_n(s, N, buf);
	}
};

template<std::size_t N>
fixed_str(char const (&)[N]) -> fixed_str<N>;

template<fixed_str name, int oflag, mode_t mode, unsigned int value>
class named_sem
{
	[[maybe_unused]] ::sem_t d_;
	::sem_t *evil() { return reinterpret_cast<::sem_t *>(this); }

public:
	named_sem() noexcept {}
	~named_sem() noexcept {}

	int getvalue(int *v) noexcept { return ::sem_getvalue(evil(), v); }
	int post() noexcept { return ::sem_post(evil()); }
	int wait() noexcept { return ::sem_wait(evil()); }
	int trywait() noexcept { return ::sem_trywait(evil()); }
	int timedwait(const struct timespec *t) noexcept { return ::sem_timedwait(evil(), t); }

	static void *operator new(std::size_t) noexcept {
		::sem_t *s = ::sem_open(name.buf, oflag, mode, value);
		return s != SEM_FAILED ? static_cast<void *>(s) : nullptr;
	}

	static void operator delete(void *ptr) noexcept {
		::sem_close(static_cast<::sem_t *>(ptr));
	}

	explicit named_sem(named_sem const &) noexcept = delete;
	explicit named_sem(named_sem const &&) noexcept = delete;
	named_sem &operator=(named_sem const &&) noexcept = delete;
	named_sem &operator=(named_sem const &) noexcept = delete;
};

#endif // NAMED_SEM_HPP_