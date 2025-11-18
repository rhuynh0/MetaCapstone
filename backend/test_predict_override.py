from predict import generate_interest_profile

urls=[
 'https://www.foodnetwork.com/shows',
 'https://www.kitchenaid.com/countertop-appliances/stand-mixers',
 'https://store.steampowered.com',
 'https://www.espn.com',
]

profile = generate_interest_profile(urls)
print(profile)
