package auth

import (
	"context"
	"futo-notes-server/internal/config"
	"futo-notes-server/internal/db"
	"path/filepath"
	"testing"
	"time"
)

func TestSessionLifetimeConfiguration(t *testing.T) {
	for _, test := range []struct {
		value string
		want  time.Duration
	}{
		{"", 7 * 24 * time.Hour}, {"10080", 7 * 24 * time.Hour}, {"2", 2 * time.Minute}, {"43200", 30 * 24 * time.Hour},
	} {
		got, err := sessionTTLFromMinutes(test.value)
		if err != nil || got != test.want {
			t.Fatalf("duration %q: got %v, %v", test.value, got, err)
		}
	}
	for _, value := range []string{"0", "-1", "1.5", "7d", "garbage", "01", "525601"} {
		if _, err := sessionTTLFromMinutes(value); err == nil {
			t.Fatalf("accepted invalid duration %q", value)
		}
	}
}

func TestConfiguredLifetimeExpiresServerSession(t *testing.T) {
	database, err := db.Open(config.Config{DatabaseURL: "sqlite:" + filepath.Join(t.TempDir(), "notes.db")})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	ctx := context.Background()
	if _, err := db.Migrate(ctx, database); err != nil {
		t.Fatal(err)
	}
	user, err := UpsertLocalUser(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	original := SessionTTL
	defer func() { SessionTTL = original }()
	SessionTTL = 2 * time.Minute
	token, err := CreateSession(ctx, database, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	session, err := ValidateSession(ctx, database, token)
	if err != nil || session == nil {
		t.Fatalf("new session is invalid: %v", err)
	}
	var expiresAt db.Time
	if err := database.QueryRowContext(ctx, `SELECT expires_at FROM sessions WHERE access_token_hash = $1`, HashToken(token)).Scan(&expiresAt); err != nil {
		t.Fatal(err)
	}
	remaining := time.Until(expiresAt.Time)
	if remaining < 110*time.Second || remaining > 120*time.Second {
		t.Fatalf("configured database expiry = %v", remaining)
	}
	if _, err := database.ExecContext(ctx, `UPDATE sessions SET expires_at = $1 WHERE access_token_hash = $2`, db.Timestamp(time.Now().Add(-time.Hour)), HashToken(token)); err != nil {
		t.Fatal(err)
	}
	session, err = ValidateSession(ctx, database, token)
	if err != nil || session != nil {
		t.Fatalf("expired session is valid: %v", err)
	}
}
