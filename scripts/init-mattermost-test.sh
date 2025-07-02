#!/bin/bash

# Mattermost Test Environment Initialization Script
# Automatically creates admin user, team, bot account, and test channels

set -e

MATTERMOST_URL="http://localhost:8066"
ADMIN_EMAIL="admin@test.local"
ADMIN_PASSWORD="admin123!"
ADMIN_USERNAME="admin"
TEAM_NAME="test-team"
TEAM_DISPLAY_NAME="Test Team"
BOT_USERNAME="eliza-test"
BOT_DISPLAY_NAME="Eliza Test Bot"

echo "Initializing Mattermost test environment..."

# Wait for Mattermost to be ready
echo "Waiting for Mattermost to be ready..."
timeout=60
while ! curl -s "$MATTERMOST_URL/api/v4/system/ping" >/dev/null 2>&1; do
    if [ $timeout -le 0 ]; then
        echo "Error: Timeout waiting for Mattermost"
        exit 1
    fi
    sleep 2
    timeout=$((timeout-2))
done
echo "Mattermost is ready"

# Check if already initialized
if curl -s "$MATTERMOST_URL/api/v4/users" | grep -q "error"; then
    echo "Setting up initial admin user..."
    
    # Create initial admin user using the setup endpoint
    SETUP_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/users" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"$ADMIN_EMAIL\",
            \"username\": \"$ADMIN_USERNAME\",
            \"password\": \"$ADMIN_PASSWORD\",
            \"first_name\": \"Test\",
            \"last_name\": \"Admin\"
        }")
    
    if echo "$SETUP_RESPONSE" | grep -q "id"; then
        echo "Admin user created successfully"
        USER_ID=$(echo "$SETUP_RESPONSE" | jq -r '.id')
    else
        echo "Error: Failed to create admin user: $SETUP_RESPONSE"
        exit 1
    fi
else
    echo "Info: Admin user already exists, proceeding with login..."
fi

# Login as admin
echo "Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/users/login" \
    -H "Content-Type: application/json" \
    -d "{
        \"login_id\": \"$ADMIN_USERNAME\",
        \"password\": \"$ADMIN_PASSWORD\"
    }")

if echo "$LOGIN_RESPONSE" | grep -q "id"; then
    echo "Admin login successful"
    # Extract auth token from headers
    AUTH_TOKEN=$(curl -s -i -X POST "$MATTERMOST_URL/api/v4/users/login" \
        -H "Content-Type: application/json" \
        -d "{
            \"login_id\": \"$ADMIN_USERNAME\",
            \"password\": \"$ADMIN_PASSWORD\"
        }" | grep -i "token:" | cut -d' ' -f2 | tr -d '\r')
else
    echo "Error: Admin login failed: $LOGIN_RESPONSE"
    exit 1
fi

# Create team
echo "Creating test team..."
TEAM_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/teams" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"$TEAM_NAME\",
        \"display_name\": \"$TEAM_DISPLAY_NAME\",
        \"type\": \"O\"
    }")

echo "Team creation response: $TEAM_RESPONSE"

if echo "$TEAM_RESPONSE" | grep -q '"id"' && ! echo "$TEAM_RESPONSE" | grep -q "app_error"; then
    echo "✓ Team created successfully"
    TEAM_ID=$(echo "$TEAM_RESPONSE" | jq -r '.id')
elif echo "$TEAM_RESPONSE" | grep -q -E "(already exists|existing team|update for existing)"; then
    echo "✓ Team already exists, fetching ID..."
    EXISTING_TEAM_RESPONSE=$(curl -s -X GET "$MATTERMOST_URL/api/v4/teams/name/$TEAM_NAME" \
        -H "Authorization: Bearer $AUTH_TOKEN")
    echo "Existing team response: $EXISTING_TEAM_RESPONSE"
    
    if echo "$EXISTING_TEAM_RESPONSE" | grep -q '"id"'; then
        TEAM_ID=$(echo "$EXISTING_TEAM_RESPONSE" | jq -r '.id')
        echo "✓ Team ID retrieved successfully: $TEAM_ID"
    else
        echo "✗ FAILED to get existing team ID: $EXISTING_TEAM_RESPONSE"
        exit 1
    fi
else
    echo "✗ FAILED to create team: $TEAM_RESPONSE"
    exit 1
fi

# Validate team ID format
if [[ ! "$TEAM_ID" =~ ^[a-z0-9]{26}$ ]]; then
    echo "✗ INVALID team ID format: '$TEAM_ID'"
    echo "Expected 26 character alphanumeric string"
    exit 1
fi

echo "✓ Team ID validated: $TEAM_ID"

# Create bot account
echo "Creating bot account..."
BOT_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/bots" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"$BOT_USERNAME\",
        \"display_name\": \"$BOT_DISPLAY_NAME\",
        \"description\": \"ElizaOS test bot for automated testing\"
    }")

echo "Bot creation response: $BOT_RESPONSE"

if echo "$BOT_RESPONSE" | grep -q '"user_id"'; then
    echo "✓ Bot account created successfully"
    BOT_USER_ID=$(echo "$BOT_RESPONSE" | jq -r '.user_id')
elif echo "$BOT_RESPONSE" | grep -q "already exists"; then
    echo "✓ Bot already exists, fetching ID..."
    EXISTING_BOT_RESPONSE=$(curl -s -X GET "$MATTERMOST_URL/api/v4/users/username/$BOT_USERNAME" \
        -H "Authorization: Bearer $AUTH_TOKEN")
    echo "Existing bot response: $EXISTING_BOT_RESPONSE"
    
    if echo "$EXISTING_BOT_RESPONSE" | grep -q '"id"'; then
        BOT_USER_ID=$(echo "$EXISTING_BOT_RESPONSE" | jq -r '.id')
        echo "✓ Bot user ID retrieved successfully: $BOT_USER_ID"
    else
        echo "✗ FAILED to get existing bot user ID: $EXISTING_BOT_RESPONSE"
        exit 1
    fi
else
    echo "✗ FAILED to create bot: $BOT_RESPONSE"
    exit 1
fi

# Validate bot user ID format
if [[ ! "$BOT_USER_ID" =~ ^[a-z0-9]{26}$ ]]; then
    echo "✗ INVALID bot user ID format: '$BOT_USER_ID'"
    echo "Expected 26 character alphanumeric string"
    exit 1
fi

echo "✓ Bot user ID validated: $BOT_USER_ID"

# Create bot token
echo "Creating bot access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/users/$BOT_USER_ID/tokens" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"description\": \"ElizaOS test token\"
    }")

if echo "$TOKEN_RESPONSE" | grep -q "token"; then
    BOT_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')
    echo "Bot token created successfully"
else
    echo "Error: Failed to create bot token: $TOKEN_RESPONSE"
    exit 1
fi

# Add bot to team
echo "Adding bot to team..."
TEAM_MEMBER_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/teams/$TEAM_ID/members" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"team_id\": \"$TEAM_ID\",
        \"user_id\": \"$BOT_USER_ID\"
    }")

echo "Team membership API response: $TEAM_MEMBER_RESPONSE"

if echo "$TEAM_MEMBER_RESPONSE" | grep -q "team_id"; then
    echo "✓ Bot added to team successfully"
elif echo "$TEAM_MEMBER_RESPONSE" | grep -q "already a member"; then
    echo "✓ Bot already a member of team"
else
    echo "✗ FAILED to add bot to team: $TEAM_MEMBER_RESPONSE"
    echo "Attempting to verify team membership..."
    
    # Verify team membership by checking if bot can see teams
    BOT_TEAMS=$(curl -s -H "Authorization: Bearer $BOT_TOKEN" "$MATTERMOST_URL/api/v4/users/me/teams")
    if echo "$BOT_TEAMS" | grep -q "$TEAM_ID"; then
        echo "✓ Bot team membership verified - bot can see team"
    else
        echo "✗ CRITICAL: Bot cannot see team despite API call"
        echo "Bot teams response: $BOT_TEAMS"
        echo "This will cause integration tests to fail!"
        exit 1
    fi
fi

# Create test channels
echo "Creating test channels..."
for channel in "general" "test-channel" "e2e-test-channel"; do
    CHANNEL_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/channels" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"team_id\": \"$TEAM_ID\",
            \"name\": \"$channel\",
            \"display_name\": \"$(echo $channel | tr '-' ' ' | awk '{for(i=1;i<=NF;i++){$i=toupper(substr($i,1,1)) substr($i,2)}} 1')\",
            \"type\": \"O\"
        }")
    
    if echo "$CHANNEL_RESPONSE" | grep -q "id"; then
        CHANNEL_ID=$(echo "$CHANNEL_RESPONSE" | jq -r '.id')
        echo "  Created channel: $channel"
        
        # Add bot to channel
        CHANNEL_MEMBER_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/channels/$CHANNEL_ID/members" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{
                \"user_id\": \"$BOT_USER_ID\"
            }")
        
        if echo "$CHANNEL_MEMBER_RESPONSE" | grep -q "channel_id"; then
            echo "    Bot added to channel successfully"
        elif echo "$CHANNEL_MEMBER_RESPONSE" | grep -q "already a member"; then
            echo "    Info: Bot already a member of channel"
        else
            echo "    Warning: Failed to add bot to channel: $CHANNEL_MEMBER_RESPONSE"
        fi
    elif echo "$CHANNEL_RESPONSE" | grep -q "already exists"; then
        echo "  Info: Channel already exists: $channel"
        
        # Get existing channel ID and add bot
        EXISTING_CHANNEL_ID=$(curl -s -X GET "$MATTERMOST_URL/api/v4/teams/$TEAM_ID/channels/name/$channel" \
            -H "Authorization: Bearer $AUTH_TOKEN" | jq -r '.id')
        
        if [ "$EXISTING_CHANNEL_ID" != "null" ] && [ -n "$EXISTING_CHANNEL_ID" ]; then
            CHANNEL_MEMBER_RESPONSE=$(curl -s -X POST "$MATTERMOST_URL/api/v4/channels/$EXISTING_CHANNEL_ID/members" \
                -H "Authorization: Bearer $AUTH_TOKEN" \
                -H "Content-Type: application/json" \
                -d "{
                    \"user_id\": \"$BOT_USER_ID\"
                }")
            
            if echo "$CHANNEL_MEMBER_RESPONSE" | grep -q "channel_id"; then
                echo "    Bot added to existing channel successfully"
            elif echo "$CHANNEL_MEMBER_RESPONSE" | grep -q "already a member"; then
                echo "    Info: Bot already a member of existing channel"
            else
                echo "    Warning: Failed to add bot to existing channel: $CHANNEL_MEMBER_RESPONSE"
            fi
        fi
    else
        echo "  Warning: Failed to create channel $channel: $CHANNEL_RESPONSE"
    fi
done

# Generate test configuration (automatic for tests)
echo "Generating test configuration..."
cat > __tests__/generated-test-config.env << EOF
# Auto-generated Mattermost test configuration
# Generated on $(date)

# Integration test variables (expected by tests)
MATTERMOST_URL=$MATTERMOST_URL
MATTERMOST_TOKEN=$BOT_TOKEN
MATTERMOST_TEAM=$TEAM_NAME
MATTERMOST_TEST_CHANNEL=general

# Standard plugin variables
MATTERMOST_SERVER_URL=$MATTERMOST_URL
MATTERMOST_BOT_TOKEN=$BOT_TOKEN
MATTERMOST_BOT_USERNAME=$BOT_USERNAME
MATTERMOST_TEAM_NAME=$TEAM_NAME
MATTERMOST_DEFAULT_CHANNEL=general

# Test environment settings
NODE_ENV=test
VITEST_ENVIRONMENT=containerized

# Admin credentials (for manual testing)
MATTERMOST_ADMIN_EMAIL=$ADMIN_EMAIL
MATTERMOST_ADMIN_PASSWORD=$ADMIN_PASSWORD
MATTERMOST_ADMIN_USERNAME=$ADMIN_USERNAME
EOF

echo ""
echo "Mattermost test environment initialized successfully!"
echo ""
echo "Summary:"
echo "  - Server URL: $MATTERMOST_URL"
echo "  - Team: $TEAM_NAME"
echo "  - Bot Username: $BOT_USERNAME"
echo "  - Bot Token: ${BOT_TOKEN:0:20}..."
echo "  - Admin Login: $ADMIN_USERNAME / $ADMIN_PASSWORD"
echo ""
echo "Test configuration generated automatically"
echo "(Your .env file remains untouched)"
echo "Ready to run tests with: npm run test"
echo "" 