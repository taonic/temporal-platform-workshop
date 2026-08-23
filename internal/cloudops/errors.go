package cloudops

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func isNotFound(err error) bool {
	s, ok := status.FromError(err)
	return ok && s.Code() == codes.NotFound
}

// IsPermanent reports whether retrying could ever help.
//
// The reconciler uses this to mark activity failures non-retryable. A namespace
// name that is already taken will still be taken in thirty seconds, and burning
// an hour of retries on it just hides the real problem from the student.
func IsPermanent(err error) bool {
	s, ok := status.FromError(err)
	if !ok {
		return false
	}
	switch s.Code() {
	case codes.InvalidArgument, codes.NotFound, codes.AlreadyExists,
		codes.PermissionDenied, codes.Unauthenticated, codes.FailedPrecondition:
		return true
	default:
		return false
	}
}
