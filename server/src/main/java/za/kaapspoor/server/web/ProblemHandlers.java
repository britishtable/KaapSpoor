package za.kaapspoor.server.web;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import za.kaapspoor.server.auth.InvalidTokenException;
import za.kaapspoor.server.auth.PasswordAuthService;

/** Extends the base handler so Spring's own 400s (bad JSON, failed validation) are ProblemDetail too. */
@RestControllerAdvice
public class ProblemHandlers extends ResponseEntityExceptionHandler {

    /** The unique index on app_user(email), from V3. */
    static final String EMAIL_INDEX = "app_user_email_idx";

    private static final Logger log = LoggerFactory.getLogger(ProblemHandlers.class);

    @ExceptionHandler(IllegalArgumentException.class)
    ProblemDetail badRequest(IllegalArgumentException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(InvalidTokenException.class)
    ProblemDetail invalidToken(InvalidTokenException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "Invalid or expired token");
    }

    @ExceptionHandler(PasswordAuthService.BadCredentialsException.class)
    ProblemDetail badCredentials(PasswordAuthService.BadCredentialsException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, e.getMessage());
    }

    /** Only the email unique index is the caller's conflict; any other violation is a server bug. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail dataIntegrity(DataIntegrityViolationException e) {
        if (violates(e, EMAIL_INDEX)) {
            return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "An account with this email already exists");
        }
        log.error("Unexpected data integrity violation", e);
        return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
    }

    private static boolean violates(Throwable e, String constraint) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof ConstraintViolationException c && constraint.equals(c.getConstraintName())) {
                return true;
            }
        }
        return false;
    }
}
