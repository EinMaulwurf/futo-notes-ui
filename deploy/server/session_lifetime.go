package auth

// Local compatibility extension: preserve FUTO's default and wire format while
// sharing the remembered-browser deadline with its server-enforced session.
import (
	"fmt"
	"os"
	"strconv"
	"time"
)

func sessionTTLFromMinutes(value string) (time.Duration, error) {
	if value == "" {
		value = "10080"
	}
	minutes, err := strconv.Atoi(value)
	if err != nil || minutes < 1 || minutes > 525600 || strconv.Itoa(minutes) != value {
		return 0, fmt.Errorf("REMEMBER_BROWSER_MINUTES must be a whole number from 1 to 525600")
	}
	return time.Duration(minutes) * time.Minute, nil
}

func configuredSessionTTL() time.Duration {
	ttl, err := sessionTTLFromMinutes(os.Getenv("REMEMBER_BROWSER_MINUTES"))
	if err != nil {
		panic(err)
	}
	return ttl
}
