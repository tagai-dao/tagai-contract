from sympy import symbols, Eq, solve, exp
from scipy.integrate import quad
import numpy as np
import matplotlib.pyplot as plt
import math


print(6.5 / math.log(15))

def y_function(x):
    return 6e9 * math.exp(x / 2.400250924947558e26)

integral_result, error = quad(y_function, 0, 10**24)

print(f"100万代币结果需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 2 * 10**24)

print(f"200万代币结果需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 5 * 10**24)

print(f"500万代币结果需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 1 * 10**25)

print(f"1000万代币结果需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 2 * 10**25)

print(f"2000万代币结果需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 1 * 10**26)

print(f"1亿代币需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 2 * 10**26)

print(f"2亿代币需要: {integral_result / 10**36}")

integral_result, error = quad(y_function, 0, 6.5 * 10**26)

print(f"6.5亿代币需要: {integral_result / 10**36}")

print(f"初始价格为：{y_function(0) / 10 ** 18} OKB, 市值为：{y_function(0) / 10 ** 9}")
print(f"bc结束价格为：{y_function(6.5 * 10**26) / 10 ** 18} OKB, 市值为：{y_function(6.5 * 10**26) / 10 ** 9}")
print(f"Dex 价格为：{19.162 / 200000000}")

# Generate x values from 0 to 7e26
x_values = np.linspace(0, 6.5 * 10**26, 500)

# Generate y values
y_values = []
for a in x_values:
    y_values.append(y_function(a))
# y_values = y_function(x_values)

# Plot the function
plt.figure(figsize=(12, 6))
plt.plot(x_values, y_values, label=r'$P = 6 \times 10^9 \times e^{\frac{x}{2.400250924947558 \times 10^{26}}}$', color='b')
plt.xlabel('x')
plt.ylabel('y')
plt.grid(True)
plt.legend()
plt.show()