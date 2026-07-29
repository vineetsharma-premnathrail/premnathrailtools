# Braking Tool Constants
# Based on DIN EN 15746-2:2021-05 standards

G = 9.81

# Standard braking distances (Reference for calculating Force Capability)
BRAKING_DATA = {
    8: 3, 10: 5, 16: 12, 20: 20, 24: 28,
    30: 45, 32: 50, 40: 75, 50: 135, 60: 180
}

# Limits for Compliance Checking
MAX_STOPPING_DISTANCES = {
    8: 6, 10: 9, 16: 18, 20: 27, 24: 36,
    30: 55, 32: 60, 40: 90, 50: 155, 60: 230,
    70: 300, 80: 400, 90: 500, 100: 620
}